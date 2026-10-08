// 停止 Harness 后运行：node meiji/scripts/migrate-story-outline.js <DSH_HOME>
// 旧大纲转为编号故事小段；先备份全部待迁移项目，写入后读回核对，失败还原。
import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { outlineFields, outlineFailures } from '../shared/story-outline.js'
import { aggregateStatus } from '../shared/drama-model.js'
import { indexFile, episodesDir, projectIds, readProjectFile, writeProjectFile, episodeSnapshot } from '../server/data/project-files.js'

export function convertOutline(value) {
  if (value && typeof value === 'object' && typeof value.故事小段 === 'string') return value
  if (typeof value === 'string' && !outlineFailures({ 故事小段: value.trim() }).length) return { 故事小段: value.trim() }
  const bodies = typeof value === 'string' ? [value.trim()] : Object.entries(value || {}).filter(([, body]) => typeof body === 'string' && body.trim()).map(([title, body]) => `${title}：\n${body.trim()}`)
  // 缩进旧稿内部的编号，避免与新的故事小段编号混淆；保留全部正文。
  return { 故事小段: bodies.filter(Boolean).map((body, index) => `${index + 1}. ${body.replace(/^(\d+[.、．])/gm, '  $1')}`).join('\n\n') }
}
const oldOutline = content => content != null && (typeof content !== 'object' || Array.isArray(content) || !Object.hasOwn(content, '故事小段'))

export async function migrateStoryOutline(home) {
  const projects = []
  for (const id of await projectIds(home)) {
    const project = await readProjectFile(home, id)
    if (!project.episodes.some(episode => oldOutline(episode.plot?.outline?.content))) continue
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
      if (!oldOutline(target?.content)) continue
      target.content = typeof target.content === 'string' && !target.content.trim() ? null : convertOutline(target.content)
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
