// 服务启动时处理上次遗留的进行中任务：一律取消，不续查、不自动恢复（用户决定）。
// 已提交到远端的视频任务尽力发送取消请求；取消失败如实写在节点上（任务可能仍在远端运行）。
// 等待用户确认的候选图片不属于进行中任务，保持不变。
import { GenerationStatus, allNodes, modelPatch } from '../../shared/drama-model.js'

export const RESTART_CANCELLED = '服务重启，任务已取消，请重新发起'

const running = node => node.operation ? node.operation.phase !== 'awaiting-confirmation' : node.status === GenerationStatus.GENERATING

export async function interruptRunning(store, { cancelRemote } = {}) {
  for (const project of await store.list()) {
    await store.interruptRecords?.(project.id)
    if (!project.episodes.some(e => e.activity || allNodes(e).some(n => n.operation || n.status === GenerationStatus.GENERATING))) continue
    // 先取消远端视频任务（不持有项目写锁），再统一落定节点状态。
    const remote = new Map()
    for (const episode of project.episodes) for (const target of allNodes(episode)) {
      const promptId = target.content?.promptId
      if (running(target) && promptId && target.content.status === 'running' && !target.content.terminal) remote.set(promptId, RESTART_CANCELLED)
    }
    await Promise.all([...remote.keys()].map(async promptId => {
      if (!cancelRemote) return remote.set(promptId, `${RESTART_CANCELLED}；未发送远端取消请求（${promptId}），任务可能仍在运行`)
      try { await cancelRemote(promptId) }
      catch (error) { remote.set(promptId, `${RESTART_CANCELLED}；远端取消失败（${promptId}）：${error.message}，任务可能仍在运行`) }
    }))
    await store.save(project.id, current => ({ activity: null, activeOperation: null, episodes: current.episodes.map(episode => {
      const next = structuredClone(episode)
      for (const target of allNodes(next)) {
        if (!running(target)) continue
        target.status = GenerationStatus.FAILED; target.error = RESTART_CANCELLED; target.operation = null
        if (target.content?.status === 'running') {
          target.content = { ...target.content, status: 'error', terminal: true, error: remote.get(target.content.promptId) || RESTART_CANCELLED }
        }
      }
      next.activity = null
      next.activityError = null
      return modelPatch(episode, next)
    }) }))
  }
}
