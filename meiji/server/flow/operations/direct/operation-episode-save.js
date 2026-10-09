// 操作：新增 / 编辑剧集
import { rm } from 'node:fs/promises'
import { addEpisode, editEpisode } from '../../../../shared/episode-rules.js'
import { writeEpisodeCover } from '../../../data/episode-data.js'
import { GenerationStatus } from '../../../models/data/drama-model.js'
import { openIncoming } from '../../steps/shared/incoming.js'
import { saveStep } from '../../../../shared/task-plans.js'
import { markPassed } from '../../../models/tasks/content-state.js'

// if (operation.action === 'episode-add' || operation.action === 'episode-edit')
export async function opEpisodeAdd(c) {
  let { operation, home, rootProjects, project, trace, note } = c
  const patch = operation.action === 'episode-add'
    ? addEpisode(project, operation.fields)
    : editEpisode(project, operation.episodeId, operation.fields)
  const episode = operation.action === 'episode-add' ? patch.episodes[0] : patch.episodes.find(item => item.id === operation.episodeId)
  if (operation.incomingId) {
    const incoming = await openIncoming(home, operation.incomingId)
    episode.cover = await writeEpisodeCover(home, project.id, episode.id, incoming.file, incoming.mime)
    await rm(incoming.directory, { recursive: true, force: true })
  }
  const previous = project.episodes.find(item => item.id === episode.id)
  await rootProjects.save(project.id, patch)
  note(operation.action === 'episode-add' ? `已添加剧集，${episode.durationSeconds} 秒` : `已保存剧集，${episode.durationSeconds} 秒`)
  if (previous && (previous.durationSeconds !== episode.durationSeconds)) {
    note('本集时长已修改，本集下游制作数据已重置，需要重新生成')
  }
  return trace
}

export const operations = {
  'episode-add': { label: '新增剧集', scope: 'project', lock: 'project', agent: false, step: saveStep('summary'), stage: 'project', run: opEpisodeAdd },
  'episode-edit': { label: '编辑剧集', scope: 'project', lock: 'project', agent: false, step: saveStep('summary'), stage: 'project', run: opEpisodeAdd },
}
