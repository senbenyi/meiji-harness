// 操作：删除项目
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkContext } from '../../../runtime/operation-context.js'
import { cascade } from '../../../../shared/pipeline-cascade.js'
import { readImageDraft } from '../../../data/image-storage.js'
import { linkStore } from '../../../data/workspace-links.js'
import { runStore } from '../../../data/run-store.js'
import { historyStore } from '../../../data/history-store.js'

// if (['project-delete', 'episode-delete'].includes(operation.action))
export async function opProjectDelete(c) {
  let { operation, deps, home, storedProjects, rootProjects, project, trace, note } = c
  if (operation.action === 'project-delete') {
    if (project.workspaceId) {
      if (!deps.workspaceController?.delete) throw Object.assign(new Error('工作区服务不可用'), { status: 503 })
      try { await deps.workspaceController.delete({ workspaceId: project.workspaceId }) }
      catch (error) { if (error.code !== 'workspace/not-found') throw error }
    }
    await linkStore(home).forgetProject(project.id)
    await storedProjects.remove(project.id)
  } else {
    const episode = project.episodes.find(item => item.id === operation.episodeId)
    if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    await rootProjects.save(project.id, current => {
      cascade(current.episodes.find(item => item.id === episode.id), { type: 'episode-delete' })
      return { episodes: current.episodes.filter(item => item.id !== episode.id),
        scriptProposals: current.scriptProposals.filter(item => item.episodeId !== episode.id) }
    })
    await rm(join(home, 'storages', 'meiji', 'projects', project.id, 'films', episode.id), { recursive: true, force: true })
    await rm(join(home, 'storages', 'meiji', 'projects', project.id, 'images', episode.id), { recursive: true, force: true })
    await runStore(home, project.id).removeEpisode(episode.id)
    for (const proposal of project.scriptProposals.filter(item => item.episodeId === episode.id && !item.runId)) await historyStore(home, project.id).remove('script-proposals', proposal.id)
    for (const draft of Object.values(episode.pendingImages || {})) {
      const file = await readImageDraft(home, draft.draftId).catch(() => null)
      if (file) await rm(file.directory, { recursive: true, force: true })
    }
  }
  if (operation.action === 'project-delete') checkContext.getStore().projectDeleted = true
  note(operation.action === 'project-delete' ? '已删除项目及本地视频' : '已删除本集及本地视频')
  return trace
}

export const operations = {
  'project-delete': { label: '删除项目', scope: 'project', agent: false, stage: 'project', run: opProjectDelete },
}
