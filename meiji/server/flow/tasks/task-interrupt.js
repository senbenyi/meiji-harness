// 服务启动时处理上次遗留的进行中任务：一律取消，不续查、不自动恢复（用户决定）。
// 网关不提供取消接口：已提交到远端的视频任务不发送取消，如实写在节点上（任务可能仍在远端运行）。
// 等待用户确认的候选图片不属于进行中任务，保持不变。
import { GenerationStatus, allNodes, modelPatch } from '../../models/data/drama-model.js'
import { markFailed } from '../../models/tasks/content-state.js'

export const RESTART_CANCELLED = '服务重启，任务已取消，请重新发起'

const libraryNodes = project => Object.values(project.library || {}).flatMap(list => list.flatMap(entry => entry.variants.map(variant => variant.image)))
const running = node => node.operation ? node.operation.phase !== 'awaiting-confirmation' : node.status === GenerationStatus.GENERATING

export async function interruptRunning(store) {
  for (const project of await store.list()) {
    const records = await store.interruptRecords?.(project.id)
    const interruptedMessage = target => records?.runStepIds?.has(target.operation?.id) ? '服务重启，步骤执行中断，任务已结束，请重新发起' : RESTART_CANCELLED
    if (!running(project.summary) && !libraryNodes(project).some(running) && !project.episodes.some(e => allNodes(e).some(n => n.operation || n.status === GenerationStatus.GENERATING))) continue
    const remote = new Map()
    for (const episode of project.episodes) for (const target of allNodes(episode)) {
      const promptId = target.content?.promptId
      if (running(target) && promptId && target.content.status === 'running' && !target.content.terminal) remote.set(promptId, `${interruptedMessage(target)}；网关不提供取消接口，远端任务（${promptId}）可能仍在运行`)
    }
    await store.save(project.id, current => {
      const summary = structuredClone(current.summary)
      if (running(summary)) markFailed(summary, interruptedMessage(summary))
      const library = structuredClone(current.library)
      for (const target of libraryNodes({ library })) if (running(target)) markFailed(target, interruptedMessage(target))
      return { summary, library, episodes: current.episodes.map(episode => {
        const next = structuredClone(episode)
        for (const target of allNodes(next)) {
          if (!running(target)) continue
          const message = interruptedMessage(target)
          markFailed(target, message)
          if (target.content?.status === 'running') {
            target.content = { ...target.content, status: 'error', terminal: true, error: remote.get(target.content.promptId) || message }
          }
        }
        return modelPatch(episode, next)
      }) }
    })
  }
}
