// 操作：删除项目
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkContext } from '../../../runtime/operation-context.js'
import { recordStore } from '../../../data/task-store.js'

// if (['project-delete', 'episode-delete'].includes(operation.action))
export async function opProjectDelete(c) {
  let { operation, home, storedProjects, rootProjects, project, trace, note } = c
  if (operation.action === 'project-delete') {
    await storedProjects.remove(project.id)
  } else {
    const episode = project.episodes.find(item => item.id === operation.episodeId)
    if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    await rootProjects.save(project.id, async current => {
      await recordStore(home, project.id).removeEpisode(episode.id)
      await rm(join(home, 'storages', 'meiji', 'projects', project.id, 'films', episode.id), { recursive: true, force: true })
      return { episodes: current.episodes.filter(item => item.id !== episode.id) }
    })
  }
  if (operation.action === 'project-delete') checkContext.getStore().projectDeleted = true
  note(operation.action === 'project-delete' ? '已删除项目及本地视频' : '已删除本集及本地视频')
  return trace
}

export const operations = {
  'project-delete': { label: '删除项目', scope: 'project', queue: 'text', agent: false, stage: 'project', run: opProjectDelete },
}
