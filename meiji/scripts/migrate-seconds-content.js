// 停止服务后运行。旧自由文本不能可靠恢复实体/对白事件，完整备份后归档并标记待生成。
import { cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectIds, readProjectFile, writeProjectFile, episodeSnapshot, indexFile, episodesDir } from '../server/data/project-files.js'
import { node } from '../shared/drama-model.js'
export function migrateSeconds(project) {
  let changed = false
  for (const e of project.episodes) {
    if (!e.plot.props) { e.plot.props = { ...node('props'), items: [] }; changed = true }
    const legacy = e.shots.items.filter(s => s.seconds.content && s.seconds.content.version !== 1)
    if (!legacy.length) continue
    changed = true
    e.shots.seconds = node('seconds')
    for (const s of legacy) {
      // 原文同时在项目内保留为不可执行的归档，便于查阅，不作运行时兼容。
      s.seconds = { ...node(`seconds:${s.id}`), archivedContent: s.seconds.content }
      for (const k of ['storyboard', 'pencil', 'video', 'tailFrame']) if (s[k]?.content) { s[k].stale = true; s[k].status = 'failed' }
    }
    if (e.assembly.content) { e.assembly.stale = true; e.assembly.status = 'failed' }
  }
  return changed
}
export async function migrate(home) {
  const backup = join(home, 'backups', `seconds-content-${Date.now()}`), changed = []
  for (const id of await projectIds(home)) {
    const project = await readProjectFile(home, id), before = episodeSnapshot(project)
    if (!migrateSeconds(project)) continue
    const directory = join(backup, id)
    await mkdir(directory, { recursive: true })
    await cp(indexFile(home, id), join(directory, 'index.json'))
    await cp(episodesDir(home, id), join(directory, 'episodes'), { recursive: true })
    try {
      await writeProjectFile(home, project, before)
      const actual = await readProjectFile(home, id)
      if (JSON.stringify(actual) !== JSON.stringify(project)) throw new Error(`迁移读回不一致：${id}`)
    } catch (error) {
      await cp(join(directory, 'episodes'), episodesDir(home, id), { recursive: true })
      const temp = `${indexFile(home, id)}.restore`
      await writeFile(temp, await readFile(join(directory, 'index.json')), { mode: 0o600 })
      await rename(temp, indexFile(home, id)); throw error
    }
    changed.push(id)
  }
  return { backup: changed.length ? backup : null, projects: changed }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await migrate(resolve(process.argv[2] || process.env.DSH_HOME || join(process.env.HOME, '.dsh')))))
