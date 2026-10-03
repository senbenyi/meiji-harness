// 服务启动时处理上次遗留的进行中任务：一律取消，不续查、不自动恢复（用户决定）。
// 网关不提供取消接口：已提交到远端的视频任务不发送取消，如实写在节点上（任务可能仍在远端运行）。
// 等待用户确认的候选图片不属于进行中任务，保持不变。
import { GenerationStatus, allNodes, modelPatch } from '../../../shared/drama-model.js'
import { markFailed } from '../../../shared/content-state.js'

export const RESTART_CANCELLED = '服务重启，任务已取消，请重新发起'

const running = node => node.operation ? node.operation.phase !== 'awaiting-confirmation' : node.status === GenerationStatus.GENERATING

export async function interruptRunning(store) {
  for (const project of await store.list()) {
    await store.interruptRecords?.(project.id)
    if (!project.episodes.some(e => allNodes(e).some(n => n.operation || n.status === GenerationStatus.GENERATING))) continue
    const remote = new Map()
    for (const episode of project.episodes) for (const target of allNodes(episode)) {
      const promptId = target.content?.promptId
      if (running(target) && promptId && target.content.status === 'running' && !target.content.terminal) remote.set(promptId, `${RESTART_CANCELLED}；网关不提供取消接口，远端任务（${promptId}）可能仍在运行`)
    }
    await store.save(project.id, current => ({ episodes: current.episodes.map(episode => {
      const next = structuredClone(episode)
      for (const target of allNodes(next)) {
        if (!running(target)) continue
        markFailed(target, RESTART_CANCELLED)
        if (target.content?.status === 'running') {
          target.content = { ...target.content, status: 'error', terminal: true, error: remote.get(target.content.promptId) || RESTART_CANCELLED }
        }
      }
      return modelPatch(episode, next)
    }) }))
  }
}
