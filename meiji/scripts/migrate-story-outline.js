// 停止 Harness 后运行：node meiji/scripts/migrate-story-outline.js <DSH_HOME>
// 旧大纲拆为七字段对象；先备份全部待迁移项目，写入后读回核对，失败还原。
import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { outlineFields, outlineFailures } from '../shared/story-outline.js'
import { aggregateStatus } from '../shared/drama-model.js'
import { indexFile, episodesDir, projectIds, readProjectFile, writeProjectFile, episodeSnapshot } from '../server/data/project-files.js'

const english = ['Motivation', 'World Rules', 'Causal Plot', 'Emotional Thread', 'Dialogue Beats', 'Ending State', 'Final Image']
export function convertOutline(text) {
  const value = Object.fromEntries(outlineFields.map(field => [field, '']))
  let field = null, prefix = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:【([^】]+)】|\[([^\]]+)\])\s*(.*)$/)
    const title = match?.[1] || match?.[2]
    const index = outlineFields.indexOf(title) >= 0 ? outlineFields.indexOf(title) : english.indexOf(title)
    if (index >= 0) {
      field = outlineFields[index]
      if (match[3]) value[field] += `${value[field] ? '\n' : ''}${match[3]}`
    } else if (field) value[field] += `${value[field] ? '\n' : ''}${line}`
    else prefix.push(line)
  }
  const preface = prefix.join('\n').trim()
  if (preface) value['因果剧情'] = [preface, value['因果剧情']].filter(Boolean).join('\n\n')
  return Object.fromEntries(Object.entries(value).map(([key, body]) => [key, body.trim()]))
}

export async function migrateStoryOutline(home) {
  const projects = []
  for (const id of await projectIds(home)) {
    const project = await readProjectFile(home, id)
    if (!project.episodes.some(episode => typeof episode.plot?.outline?.content === 'string')) continue
    if (project.activity || project.episodes.some(episode => episode.activity)) throw new Error(`${id} 仍有任务运行，先停止任务再迁移`)
    projects.push(project)
  }
  if (!projects.length) return { migrated: 0 }
  const backup = join(home, 'backups', `story-outline-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  for (const project of projects) {
    const folder = join(backup, project.id)
    await mkdir(folder, { recursive: true })
    await cp(indexFile(home, project.id), join(folder, 'index.json'))
    await cp(episodesDir(home, project.id), join(folder, 'episodes'), { recursive: true })
  }
  const incomplete = []
  for (const project of projects) {
    const next = structuredClone(project)
    for (const episode of next.episodes) {
      const target = episode.plot?.outline
      if (typeof target?.content !== 'string') continue
      target.content = target.content.trim() ? convertOutline(target.content) : null
      const failures = target.content && outlineFailures(target.content)
      if (failures?.length) {
        target.check = { ...target.check, passed: false, failures, revision: target.revision }
        target.status = 'failed'; episode.plot.status = 'failed'; episode.status = 'failed'
        incomplete.push({ projectId: project.id, episodeId: episode.id })
      }
    }
    if (incomplete.some(item => item.projectId === project.id)) next.status = aggregateStatus(next.episodes)
    try {
      await writeProjectFile(home, next, episodeSnapshot(project))
      if (JSON.stringify(await readProjectFile(home, project.id)) !== JSON.stringify(next)) throw new Error('读回内容不一致')
    } catch (error) {
      const folder = join(backup, project.id)
      await cp(join(folder, 'episodes'), episodesDir(home, project.id), { recursive: true, force: true })
      await cp(join(folder, 'index.json'), indexFile(home, project.id), { force: true })
      throw new Error(`大纲迁移失败，已还原项目 ${project.id}：${error.message}`)
    }
  }
  return { migrated: projects.length, backup, incomplete }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-story-outline.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateStoryOutline(resolve(process.argv[2])), null, 2))
}
