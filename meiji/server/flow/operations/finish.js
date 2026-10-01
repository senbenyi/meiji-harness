// 操作结束时释放节点：把本次操作占用的节点恢复为终态，并释放项目/剧集的活动标记。
// 接口失败（未保存任何草稿）时整体回退到操作开始前的内容；其余情况按自检结果或失败原因落定状态。
// 「接口失败」「已保存草稿」都从本操作执行过的步骤推导。
import { projectStore } from '../../data/projects.js'
import { executionSteps } from '../../data/task-store.js'
import { allNodes, GenerationStatus, modelPatch, targetNode } from '../../../shared/drama-model.js'

export async function releaseOperation({ operation, deps, operationId, context, state }) {
  if (!operation.projectId || context.projectDeleted || operation.action === 'episode-summary-draft') return
  const steps = executionSteps(state.execution)
  // 步骤之外的接口失败只记在错误上（见 markApiFailure）。
  const apiFailure = steps.some(step => step.apiFailure) || Boolean(state.failure?.apiFailure)
  const draftSaved = steps.some(step => step.saved)
  await projectStore(deps.home).save(operation.projectId, current => {
    const next = structuredClone(current)
    let changed = false
    for (const episode of next.episodes) {
      if (apiFailure && !draftSaved) {
        const original = context.originalRoot?.episodes.find(item => item.id === episode.id)
        const owned = allNodes(episode).filter(target => target.operation?.id === operationId).map(target => target.id)
        const restore = new Set(owned)
        for (const id of owned) {
          const [kind, track] = id.split(':')
          const downstream = kind === 'film' && track ? ['tailFrame'] : kind === 'shot' && track ? ['seconds', 'storyboard', 'pencil', 'film', 'tailFrame'] : kind === 'seconds' && track ? ['storyboard', 'pencil', 'film', 'tailFrame'] : kind === 'storyboard' && track ? ['pencil', 'film', 'tailFrame'] : []
          for (const child of downstream) restore.add(`${child}:${track}`)
        }
        if (owned.length && original) {
          for (const id of restore) {
            const target = targetNode(episode, id), previous = targetNode(original, id)
            if (!target || !previous || (target.operation && target.operation.id !== operationId)) continue
            const review = target.review, draft = target.draft
            Object.assign(target, structuredClone(previous), { review, draft, operation: previous.operation?.phase === 'awaiting-confirmation' ? structuredClone(previous.operation) : null })
          }
          if (operation.draftId && original.pendingImages?.[operation.draftId]) episode.pendingImages[operation.draftId] = structuredClone(original.pendingImages[operation.draftId])
          if (owned.includes('outline')) episode.shots = structuredClone(original.shots)
          const completed = allNodes(episode).some(value => !restore.has(value.id) && value.check?.passed === true && value.revision !== targetNode(original, value.id)?.revision)
          if (!completed && ['outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'film', 'films'].includes(operation.action)) episode.assembly = structuredClone(original.assembly)
          episode.activity = null
          episode.activityError = original.activityError || null
          Object.assign(episode, modelPatch(episode, {}))
          changed = true
        }
        continue
      }
      let episodeChanged = false
      const stopped = Boolean(state.failure) || Boolean(deps.signal?.aborted)
      for (const target of allNodes(episode)) {
        if (target.operation?.id !== operationId || target.operation.phase === 'awaiting-confirmation') continue
        if (!stopped && target.check?.passed != null) {
          target.operation = null
          target.error = null
          target.status = target.check.passed ? GenerationStatus.PASSED : GenerationStatus.FAILED
        } else {
          target.error = state.failure?.message || '任务已停止，请重新发起'
          target.status = GenerationStatus.FAILED
          target.operation = null
        }
        episodeChanged = true
        changed = true
      }
      if (episode.id === operation.episodeId && episode.activity && !allNodes(episode).some(n => n.operation)) { episode.activity = null; episodeChanged = true; changed = true }
      if (episodeChanged) episode.status = modelPatch(episode, {}).status
    }
    if (next.activeOperation === operationId) { next.activity = null; next.activeOperation = null; if (apiFailure) next.activityError = context.originalRoot?.activityError || null; changed = true }
    return changed ? next : null
  })
}
