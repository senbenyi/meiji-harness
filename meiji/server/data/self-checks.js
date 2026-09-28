import { GenerationStatus, targetNode, begin, finish, saveReview, modelPatch } from '../../shared/drama-model.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { feedbackKey, feedbackOf } from '../../shared/feedback.js'
export const checkContext = new AsyncLocalStorage()
export function markApiFailure(error) {
  const context = checkContext.getStore()
  if (context?.signal?.aborted || error.name === 'AbortError') return error
  error.apiFailure = true
  if (context) context.apiFailure = error
  return error
}
const batchActions = new Set(['seconds', 'storyboard', 'shot-boards', 'films'])
const generationActions = new Set(['characters', 'scenes', 'scene-text', 'episode-generate', 'outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'storyboard', 'shot-storyboard', 'shot-boards', 'image', 'revise-image', 'part-image', 'pencil', 'film', 'films', 'assemble', 'storyboard-text', 'outline-text'])
function keys(project, operation) {
  if (operation.action === 'outline' || operation.action === 'outline-text') return ['outline', 'characters', 'scenes']
  const kind = { seconds: 'seconds', storyboard: 'storyboard', 'shot-boards': 'storyboard', films: 'film' }[operation.action]
  const shots = operation.action === 'films' ? project.shots.items.filter(shot => shot.video.content?.status !== 'ready' || shot.video.stale) : project.shots.items
  return kind ? shots.map(shot => `${kind}:${shot.id}`) : [feedbackKey(operation)]
}
export function checkReasons(project, operation) {
  if (operation.action === 'seconds') return [...feedbackOf(project, 'seconds').check.failures, project.shots.seconds?.review.text].filter(Boolean)
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
function originalData(project, key) {
  if (!key) return null
  const value = targetNode(project, key)
  if (value?.content || value?.items?.length || value?.failedOutput) return value.content || value.items || value.failedOutput
  const [kind, id, slot] = key.split(':')
  if (kind === 'image' && slot) return project.plot?.characters.items.find(item => item.id === id)?.[slot]?.at(-1)
  return null
}
export function withReviewPrompt(prompt, includeOriginal = true) {
  const review = checkContext.getStore()?.review
  if (!review) return prompt
  const context = checkContext.getStore()
  const original = context?.originalCandidate || originalData(context?.originalProject || {}, feedbackKey(context?.target || context?.originalOperation || {}))
  const previous = includeOriginal && (original?.request?.prompt || original?.prompt || original?.origin?.prompt)
  return `${prompt}${previous && !prompt.includes('原生成提示词（修改基稿）') ? `\n原生成提示词（修改基稿）：\n${typeof previous === 'string' ? previous : JSON.stringify(previous)}` : ''}${prompt.includes(review) ? '' : `\n本次意见（在原内容基础上修改，保留未涉及部分）：\n${review}`}`
}
export async function prepareChecks(store, project, operation) {
  if (!generationActions.has(operation.action)) return { store, project, operation }
  const manual = ['scene-text', 'storyboard-text', 'outline-text', 'assemble'].includes(operation.action)
  const mode = manual ? 'modify' : operation.generationMode || (operation.review || operation.instruction ? 'modify' : 'regenerate')
  if (!['regenerate', 'modify'].includes(mode)) throw Object.assign(new Error('不支持的生成模式'), { status: 400 })
  const candidate = operation.draftId && project.pendingImages?.[operation.draftId]
  const matchingCandidate = candidate && (operation.track ? candidate.track === operation.track : candidate.itemId === operation.itemId && (candidate.slot || '') === (operation.slot || '')) ? candidate : null
  if (!manual && mode === 'modify') {
    const reasons = keys(project, operation).flatMap(key => {
      const value = feedbackOf(project, key)
      return [...(value.check.passed === false ? value.check.failures : []), operation.review ?? operation.instruction ?? (operation.action === 'seconds' ? project.shots.seconds?.review.text : value.review.text)]
    }).filter(value => String(value || '').trim())
    const originals = keys(project, operation).map(key => originalData(project, key))
    if (!reasons.length || !originals.length || (!matchingCandidate && originals.some(value => !value))) {
      throw Object.assign(new Error('修改需要原来的数据，以及自审意见或人工意见之一'), { status: 400 })
    }
  }
  operation = { ...operation, generationMode: mode, ...(mode === 'regenerate' ? { review: '', instruction: '' } : {}) }
  const fresh = mode === 'regenerate' ? undefined : operation.review ?? (operation.action === 'revise-image' ? operation.instruction : undefined)
  project = await store.save(project.id, current => {
    const next = structuredClone(current)
    if (matchingCandidate) delete next.pendingImages[matchingCandidate.draftId]
    if (operation.action === 'seconds') {
      const group = targetNode(next, 'seconds')
      if (fresh !== undefined) saveReview(group, String(fresh))
      begin(group, { id: checkContext.getStore()?.operationId || `${Date.now()}`, action: 'seconds', consumesReview: mode === 'modify' })
    }
    for (const key of keys(next, operation)) {
      const target = targetNode(next, key)
      if (!target) continue
      if (matchingCandidate && target.operation?.phase === 'awaiting-confirmation') target.operation = null
      if (fresh !== undefined && operation.action !== 'seconds') saveReview(target, String(fresh))
      target.dependencies = { summary: next.summary.revision, outline: next.plot.outline.revision, shots: next.shots.revision, ...(operation.track ? { seconds: next.shots.items.find(shot => shot.id === operation.track)?.seconds.revision } : {}) }
      if (!batchActions.has(operation.action) && !target.operation) begin(target, { id: checkContext.getStore()?.operationId || `${Date.now()}`, action: operation.action, consumesReview: mode === 'modify' })
    }
    return next
  })
  const review = mode === 'regenerate' ? '' : checkReasons(project, operation).join('\n')
  const context = checkContext.getStore()
  if (context) { context.generationMode = mode; context.originalCandidate = matchingCandidate; context.originalOperation = operation; context.originalProject = structuredClone(project); context.review = review; context.batchReview = String(operation.action === 'seconds' ? project.shots.seconds?.review.text || '' : fresh ?? ''); context.startTarget = async operation => {
    if (!operation.track) return
    await store.save(project.id, current => {
      const next = structuredClone(current), target = targetNode(next, feedbackKey(operation))
      if (target && !target.operation) begin(target, { id: context.operationId, action: operation.action, consumesReview: mode === 'modify' })
      return next
    })
  } }
  const wrapped = Object.create(store)
  wrapped.save = async (id, patch) => {
    if (checkContext.getStore()?.apiFailure) return store.read(id)
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
        if (!checkContext.getStore()?.textNodeSaving && value.check?.passed == null && old.check?.passed === false) value.check = structuredClone(old.check)
        value.review = structuredClone(old.review)
        value.operation = old.operation
        value.dependencies = old.dependencies
      }
      if (checkContext.getStore()?.textNodeSaving) {
        for (const key of keys(next, targetOperation)) {
          const value = targetNode(next, key)
          if (value?.operation) { value.status = GenerationStatus.GENERATING; value.operation.phase = value.check?.passed == null ? 'reviewing' : 'reviewed' }
        }
      }
      const filmRunning = targetOperation.action === 'film' && target?.content?.status === 'running'
      if (!checkContext.getStore()?.textNodeSaving && (changes.activity === null || partial) && !filmRunning && !batchActions.has(targetOperation.action)) {
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
            if (value) { value.status = GenerationStatus.FAILED; value.error = String(failed); value.operation = null }
          }
        } else {
          const validation = ['shots', 'revise-shot'].includes(targetOperation.action) && next.shots.check.passed === false ? next.shots.check.failures : []
          setCheck(next, targetOperation, [...validation, ...(checkContext.getStore()?.validation || [])])
        }
      }
      return modelPatch(current, next)
    })
    if (!checkContext.getStore()?.deferCheckFailure && checkContext.getStore()?.validation?.length && saved.activity) throw Object.assign(new Error(`自检未通过：${checkContext.getStore().validation.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
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
  context.review = context.generationMode === 'regenerate' ? '' : context.originalOperation?.action === 'seconds' ? context.batchReview : [...new Set([...checkReasons(project, operation), context.batchReview].filter(Boolean))].join('\n')
}
