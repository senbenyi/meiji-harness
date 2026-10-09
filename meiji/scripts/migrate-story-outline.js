// 停止 Harness 后运行：node meiji/scripts/migrate-story-outline.js <DSH_HOME>
// 旧大纲转为带时长的故事小段数组；先备份全部待迁移项目，写入后读回核对，失败还原。
import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { outlineFailures } from '../shared/story-outline.js'
import { aggregateStatus } from '../shared/drama-model.js'
import { indexFile, episodesDir, projectIds, readProjectFile, writeProjectFile, episodeSnapshot } from '../server/data/project-files.js'

export function convertOutline(value, durationSeconds) {
  if (Array.isArray(value)) return value
  const text = typeof value === 'string' ? value.trim() : typeof value?.故事小段 === 'string' ? value.故事小段.trim() : ''
  const markers = [...text.matchAll(/^(\d+)[.、．]\s*/gm)]
  let bodies
  if (markers.length && markers[0].index === 0) bodies = markers.map((marker, index) => text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim())
  else if (text) bodies = [text]
  else bodies = Object.entries(value || {}).filter(([, body]) => typeof body === 'string' && body.trim()).map(([title, body]) => `${title}：\n${body.trim()}`)
  if (!bodies.length) return null
  // 仅迁移时按正文长度分配暂估预算；不改正文，不声称语义审核通过。
  const total = Math.max(durationSeconds, bodies.length), remaining = total - bodies.length
  const weights = bodies.map(body => Math.max(1, body.length)), weight = weights.reduce((sum, n) => sum + n, 0)
  let used = 0, cumulative = 0
  return bodies.map((正文, index) => {
    cumulative += weights[index]
    const end = Math.round(remaining * cumulative / weight), 时长秒 = 1 + end - used
    used = end
    return { 编号: index + 1, 时长秒, 正文 }
  })
}
const oldOutline = content => content != null && !Array.isArray(content)

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
      target.content = typeof target.content === 'string' && !target.content.trim() ? null : convertOutline(target.content, episode.durationSeconds)
      const failures = target.content && outlineFailures(target.content, episode.durationSeconds)
      if (target.content) {
        target.revision++
        target.check = { ...target.check, passed: null, failures: ['分段时长为旧稿迁移暂估值，请复审或调整后保存'], revision: target.revision }
        target.status = 'failed'; episode.plot.status = 'failed'; episode.status = 'failed'
      }
      if (failures?.length) {
        target.check = { ...target.check, passed: false, failures, revision: target.revision }
        target.status = 'failed'; episode.plot.status = 'failed'; episode.status = 'failed'
        incomplete.push({ projectId: project.id, episodeId: episode.id })
      }
    }
    next.status = aggregateStatus(next.episodes)
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
