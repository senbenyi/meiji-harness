import { GenerationStatus, targetNode, begin, finish, saveReview, modelPatch } from '../../client/drama-model.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { feedbackKey, feedbackOf } from '../../client/feedback.js'
export const checkContext = new AsyncLocalStorage()
const batchActions = new Set(['seconds', 'storyboard', 'shot-boards', 'films'])
const generationActions = new Set(['characters', 'scenes', 'scene-text', 'episode-generate', 'outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'storyboard', 'shot-storyboard', 'shot-boards', 'image', 'revise-image', 'part-image', 'pencil', 'film', 'films', 'assemble', 'storyboard-text', 'outline-text'])
function keys(project, operation) {
  if (operation.action === 'outline' || operation.action === 'outline-text') return ['outline', 'characters', 'scenes']
  const kind = { seconds: 'seconds', storyboard: 'storyboard', 'shot-boards': 'storyboard', films: 'film' }[operation.action]
  const shots = operation.action === 'films' ? project.shots.items.filter(shot => shot.video.content?.status !== 'ready' || shot.video.stale) : project.shots.items
  return kind ? shots.map(shot => `${kind}:${shot.id}`) : [feedbackKey(operation)]
}
export function checkReasons(project, operation) {
  return [...new Set(keys(project, operation).flatMap(key => {
    const { check, review } = feedbackOf(project, key)
    return [...(check.passed === false ? check.failures : []), review.text]
  }).filter(Boolean))]
}
export function setCheck(project, operation, reasons) {
  for (const key of keys(project, operation)) {
    const target = targetNode(project, key)
    if (target) finish(target, { passed: reasons.length === 0, failures: [...new Set(reasons.filter(Boolean))], ...(checkContext.getStore()?.reviewHistory ? { history: structuredClone(checkContext.getStore().reviewHistory) } : {}) })
  }
  return project
}
export function withReviewPrompt(prompt) {
  const review = checkContext.getStore()?.review
  return review && !prompt.includes(review) ? `${prompt}\n本次意见（在原内容基础上修改，保留未涉及部分）：\n${review}` : prompt
}
export async function prepareChecks(store, project, operation) {
  if (!generationActions.has(operation.action)) return { store, project, operation }
  const fresh = operation.review ?? (operation.action === 'revise-image' ? operation.instruction : undefined)
  project = await store.save(project.id, current => {
    const next = structuredClone(current)
    for (const key of keys(next, operation)) {
      const target = targetNode(next, key)
      if (!target) continue
      if (fresh !== undefined) saveReview(target, String(fresh))
      target.dependencies = { summary: next.summary.revision, outline: next.plot.outline.revision, shots: next.shots.revision, ...(operation.track ? { seconds: next.shots.items.find(shot => shot.id === operation.track)?.seconds.revision } : {}) }
      if (!batchActions.has(operation.action) && !target.operation) begin(target, { id: checkContext.getStore()?.operationId || `${Date.now()}`, action: operation.action })
    }
    return next
  })
  const review = checkReasons(project, operation).join('\n')
  const context = checkContext.getStore()
  if (context) { context.originalProject = structuredClone(project); context.review = review; context.batchReview = String(fresh ?? ''); context.startTarget = async operation => {
    if (!operation.track) return
    await store.save(project.id, current => {
      const next = structuredClone(current), target = targetNode(next, feedbackKey(operation))
      if (target && !target.operation) begin(target, { id: context.operationId, action: operation.action })
      return next
    })
  } }
  const wrapped = Object.create(store)
  wrapped.save = async (id, patch) => {
    const saved = await store.save(id, current => {
      const changes = typeof patch === 'function' ? patch(current) : patch
      const next = structuredClone({ ...current, ...changes })
      const targetOperation = checkContext.getStore()?.target || operation
      const target = targetNode(next, feedbackKey(targetOperation))
      const partial = targetOperation !== operation && (changes.shots && ['shot-seconds', 'shot-storyboard', 'film'].includes(targetOperation.action))
      // Preserve pending opinions and operation ownership when replacing generated nodes.
      for (const key of keys(next, targetOperation)) {
        const old = targetNode(current, key), value = targetNode(next, key)
        if (!old || !value) continue
        value.review = structuredClone(old.review)
        value.operation = old.operation
        value.dependencies = old.dependencies
      }
      const filmRunning = targetOperation.action === 'film' && target?.content?.status === 'running'
      if ((changes.activity === null || partial) && !filmRunning && !batchActions.has(targetOperation.action)) {
        const failed = changes.activityError || target?.content?.error
        const awaitingImage = ['image', 'revise-image', 'part-image', 'pencil'].includes(targetOperation.action) && Object.values(next.pendingImages || {}).some(draft => targetOperation.track ? draft.track === targetOperation.track : draft.itemId === targetOperation.itemId)
        if (awaitingImage) {
          for (const key of keys(next, targetOperation)) {
            const value = targetNode(next, key)
            if (value?.operation) value.operation.phase = 'awaiting-confirmation'
          }
        } else if (failed) {
          for (const key of keys(next, targetOperation)) {
            const value = targetNode(next, key)
            if (value) { value.status = checkContext.getStore()?.signal?.reason?.code === 'TASK_PAUSED' ? GenerationStatus.PAUSED : GenerationStatus.FAILED; value.error = value.status === GenerationStatus.PAUSED ? null : String(failed); value.operation = null }
          }
        } else {
          const validation = ['shots', 'revise-shot'].includes(targetOperation.action) && next.shots.check.passed === false ? next.shots.check.failures : []
          setCheck(next, targetOperation, [...validation, ...(checkContext.getStore()?.validation || [])])
        }
      }
      return modelPatch(current, next)
    })
    if (checkContext.getStore()?.validation?.length && saved.activity) throw Object.assign(new Error(`自检未通过：${checkContext.getStore().validation.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
    return saved
  }
  return { store: wrapped, project, operation: { ...operation, review } }
}
export async function selectCheck(project, operation) {
  const context = checkContext.getStore()
  if (!context) return
  context.signal?.throwIfAborted()
  await context.startTarget?.(operation)
  context.validation = []
  context.reviewHistory = undefined
  context.target = operation
  context.review = [...new Set([...checkReasons(project, operation), context.batchReview].filter(Boolean))].join('\n')
}
