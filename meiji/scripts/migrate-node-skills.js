// 停止服务后执行：node meiji/scripts/migrate-node-skills.js <DSH_HOME>
// 将摘要/剧情的整剧补充复制到现有每集对应节点；新剧集不继承。指导与其他阶段保持原存储。
import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { episodeSnapshot, episodesDir, indexFile, projectIds, readProjectFile, writeProjectFile } from '../server/data/project-files.js'

export function migrateProjectNodeSkills(project) {
  const next = structuredClone(project)
  for (const episode of next.episodes) {
    episode.supplementalSkills ||= {}
    for (const [id, keys] of Object.entries({ episode: ['summary'], outline: ['outline', 'characters', 'scenes'] })) {
      const fields = next.skills?.additions?.[id] || {}
      const content = ['common', 'generate', 'revise', 'review'].filter(field => fields[field]).map(field => `【原补充·${field}】\n${fields[field]}`).join('\n\n')
      if (content) for (const key of keys) episode.supplementalSkills[key] = [...(episode.supplementalSkills[key] || []), { id: randomUUID(), content }]
    }
  }
  if (next.skills?.additions) { delete next.skills.additions.episode; delete next.skills.additions.outline }
  return next
}
export async function migrateNodeSkills(home) {
  const pending = []
  for (const id of await projectIds(home)) {
    const before = await readProjectFile(home, id), next = migrateProjectNodeSkills(before)
    if (JSON.stringify(before) !== JSON.stringify(next)) pending.push({ before, next })
  }
  if (!pending.length) return { migrated: 0 }
  const backup = join(home, 'backups', 'node-skills-' + new Date().toISOString().replace(/[:.]/g, '-'))
  // 所有待迁移项目先备份，之后才写入。
  for (const { before } of pending) {
    const target = join(backup, before.id)
    await mkdir(target, { recursive: true })
    await cp(indexFile(home, before.id), join(target, 'index.json'))
    await cp(episodesDir(home, before.id), join(target, 'episodes'), { recursive: true })
  }
  for (const { before, next } of pending) {
    try {
      await writeProjectFile(home, next, episodeSnapshot(before))
      if (JSON.stringify(await readProjectFile(home, before.id)) !== JSON.stringify(next)) throw new Error('读回数据不一致')
    } catch (error) {
      const target = join(backup, before.id)
      await cp(join(target, 'episodes'), episodesDir(home, before.id), { recursive: true, force: true })
      await cp(join(target, 'index.json'), indexFile(home, before.id), { force: true })
      throw new Error(`迁移失败，已还原 ${before.id}：${error.message}；备份 ${backup}`)
    }
  }
  return { migrated: pending.length, backup }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-node-skills.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateNodeSkills(resolve(process.argv[2]))))
}
