// 职责：一次性把旧导演 JSON 转为标准 Skill，并把项目引用迁到稳定 Skill 名。
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { withConfig, defaultElysiumHome } from '../src/config.js'
import { mkdir, readdir, rename, writeFile } from '../src/database/files.js'
import { readJson, saveJson } from '../src/database/json.js'
import { poolsRoot, projectsRoot, runtimeRoot, skillsRoot } from '../src/database/paths.js'
import { createSkillsStore } from '../src/database/managers/skills.js'
import { validProjectId } from '../src/database/schemas/projects.js'

if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('仅支持 --dry-run')
const dryRun = process.argv.includes('--dry-run')
const root = process.env.ELYSIUM_STATE_ROOT || defaultElysiumHome()

await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
  const source = join(poolsRoot(), 'directors.json'), legacy = await readJson(source)
  if (legacy === null) { console.log(JSON.stringify({ directors: 0, projects: 0, already_migrated: true, dry_run: dryRun })); return }
  if (!Array.isArray(legacy)) throw new Error('旧导演库不是数组')
  const names = new Map(legacy.map((item, index) => [item.name, `director-${String(index + 1).padStart(3, '0')}`]))
  if (names.size !== legacy.length) throw new Error('旧导演名称重复')
  const entries = await readdir(projectsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !validProjectId(entry.name)) continue
    const path = join(projectsRoot(), entry.name, 'project.json'), value = await readJson(path)
    if (!value?.director || [...names.values()].includes(value.director)) continue
    if (!names.has(value.director)) throw new Error(`项目 ${entry.name} 引用的导演不在旧导演库`)
    projects.push({ path, value, name: names.get(value.director) })
  }
  console.log(JSON.stringify({ directors: legacy.length, projects: projects.length, dry_run: dryRun }))
  if (dryRun) return
  const skills = createSkillsStore()
  for (const [index, director] of legacy.entries()) {
    const name = names.get(director.name)
    const existing = await skills.get(name).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (existing && existing.metadata?.display_name !== director.name) throw new Error(`Skill ${name} 已被其他导演占用`)
    if (!existing) {
      const content = `---\nname: ${name}\ndescription: ${JSON.stringify((director.style || director.name).slice(0, 160))}\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(director.name)}\n  order: ${index}\n---\n\n# ${director.name}\n\n## 风格\n\n${director.style}\n\n代表作品见 references/works.md。\n`
      await skills.save(name, content)
    }
    const references = join(skillsRoot(), name, 'references')
    await mkdir(references, { recursive: true })
    await writeFile(join(references, 'works.md'), `# ${director.name}代表作与 TOP 参考\n\n${(director.works || []).map(work => `- ${work}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  }
  for (const { path, value, name } of projects) await saveJson(path, { ...value, director: name, updated_at: Math.max(Date.now(), value.updated_at + 1) })
  const archive = join(runtimeRoot(), 'migrations')
  await mkdir(archive, { recursive: true })
  await rename(source, join(archive, `directors-${randomUUID()}.json`))
})
