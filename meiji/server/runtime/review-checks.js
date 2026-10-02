import { GenerationStatus, targetNode, begin, finish, saveReview, modelPatch, episodeModel } from '../../shared/drama-model.js'
import { feedbackKey, feedbackOf, uniqueFeedback, scopedCheck } from '../../shared/review-feedback.js'
import { checkContext, apiFailed, inTextStep } from './operation-context.js'
const batchActions = new Set(['seconds', 'storyboard', 'shot-boards', 'films'])
const limitedOpinionActions = new Set(['shots', 'revise-shot', 'shot-seconds', 'image', 'revise-image', 'pencil'])
const generationActions = new Set(['characters', 'scenes', 'props', 'scene-text', 'character-text', 'episode-generate', 'outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'storyboard', 'shot-storyboard', 'storyboard-bind', 'shot-boards', 'image', 'revise-image', 'part-image', 'pencil', 'film', 'films', 'assemble', 'storyboard-text', 'outline-text'])
function keys(project, operation) {
  if (operation.action === 'outline' && operation.stageKey) return [operation.stageKey]
  if (operation.action === 'outline' || operation.action === 'outline-text') return ['outline', 'characters', 'scenes', 'props']
  const kind = { seconds: 'seconds', storyboard: 'storyboard', 'shot-boards': 'storyboard', films: 'film' }[operation.action]
  const shots = operation.action === 'films' ? project.shots.items.filter(shot => shot.video.content?.status !== 'ready' || shot.video.stale) : project.shots.items
  return kind ? shots.map(shot => `${kind}:${shot.id}`) : [feedbackKey(operation)]
}
export function checkReasons(project, operation) {
  if (operation.action === 'seconds') return uniqueFeedback([...feedbackOf(project, 'seconds').check.failures, project.shots.seconds?.review.text])
  return [...new Set(keys(project, operation).flatMap(key => {
    const { check, review } = feedbackOf(project, key)
    return [...(check.passed === false ? check.failures : []), review.text]
  }).filter(Boolean))]
}
export function setCheck(project, operation, reasons) {
  for (const key of keys(project, operation)) {
    const target = targetNode(project, key)
    if (target) finish(target, operation.action === 'outline' && checkContext.getStore()?.storyStages
      ? target.check : operation.action === 'seconds' ? scopedCheck({ passed: reasons.length === 0, failures: uniqueFeedback(reasons) }, key.split(':')[1]) : { passed: reasons.length === 0, failures: uniqueFeedback(reasons) })
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
  const manual = ['scene-text', 'character-text', 'storyboard-text', 'outline-text', 'assemble'].includes(operation.action)
  const mode = manual ? 'modify' : operation.generationMode || (operation.review || operation.instruction ? 'modify' : 'regenerate')
  if (!['regenerate', 'modify'].includes(mode)) throw Object.assign(new Error('不支持的生成模式'), { status: 400 })
  // 人工输入限长；自审问题随后完整合并，不套用人工输入上限。
  // 在保存和清理下游前校验，拒绝输入时保留原内容与意见。
  if (mode === 'modify' && limitedOpinionActions.has(operation.action)) {
    const humanOpinions = operation.review != null || operation.instruction != null
      ? [operation.review, operation.instruction]
      : keys(project, operation).map(key => feedbackOf(project, key).review.text)
    if (humanOpinions.some(value => String(value || '').trim().length > 2000)) {
      throw Object.assign(new Error('审核意见过长'), { status: 400 })
    }
  }
  const candidate = operation.draftId && project.pendingImages?.[operation.draftId]
  const matchingCandidate = candidate && (operation.track ? candidate.track === operation.track : candidate.itemId === operation.itemId && (candidate.slot || '') === (operation.slot || '')) ? candidate : null
  if (!manual && mode === 'modify') {
    const reasons = keys(project, operation).flatMap(key => {
      const value = feedbackOf(project, key)
      return [...(value.check.passed === false ? value.check.failures : []), operation.review ?? operation.instruction ?? (operation.action === 'seconds' ? project.shots.seconds?.review.text : value.review.text)]
    }).filter(value => String(value || '').trim())
    const originals = (operation.action === 'outline' ? ['outline'] : keys(project, operation)).map(key => originalData(project, key))
    // 整集每秒指令允许部分保存：至少一镜有原内容即可修改，缺失的镜头随意见一起补齐。
    const missing = operation.action === 'seconds' ? originals.every(value => !value) : originals.some(value => !value)
    if (!reasons.length || !originals.length || (!matchingCandidate && missing)) {
      throw Object.assign(new Error('修改需要原来的数据，以及自审意见或人工意见之一'), { status: 400 })
    }
  }
  operation = { ...operation, generationMode: mode, ...(mode === 'regenerate' ? { review: '', instruction: '' } : {}) }
  const fresh = mode === 'regenerate' ? undefined : operation.review ?? (operation.action === 'revise-image' ? operation.instruction : undefined)
  project = await store.save(project.id, current => {
    const next = structuredClone(current)
    next.activityError = null
    // 重新生成剧情先清空本集旧产物；修改模式仍以原稿为基础。
    if (operation.action === 'outline' && mode === 'regenerate') {
      const empty = episodeModel(next.id, {})
      for (const key of ['plot', 'shots', 'assembly', 'pendingImages']) next[key] = empty[key]
      for (const key of ['plot', 'outline', 'characters', 'scenes', 'props', 'shots', 'seconds', 'assembly']) {
        targetNode(next, key).revision = (targetNode(current, key)?.revision || 0) + 1
      }
    }
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
    if (apiFailed()) return store.read(id)
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
        if (!inTextStep() && value.check?.passed == null && old.check?.passed === false) value.check = structuredClone(old.check)
        value.review = structuredClone(old.review)
        value.operation = old.operation
        value.dependencies = old.dependencies
      }
      if (inTextStep()) {
        for (const key of keys(next, targetOperation)) {
          const value = targetNode(next, key)
          if (value?.operation) { value.status = GenerationStatus.GENERATING; value.operation.phase = value.check?.passed == null ? 'reviewing' : 'reviewed' }
        }
      }
      const filmRunning = targetOperation.action === 'film' && target?.content?.status === 'running'
      if (!inTextStep() && (changes.activity === null || partial) && !filmRunning && !batchActions.has(targetOperation.action)) {
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
    if (!inTextStep() && checkContext.getStore()?.validation?.length && saved.activity) throw Object.assign(new Error(`自检未通过：${checkContext.getStore().validation.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
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
  context.target = operation
  context.review = context.generationMode === 'regenerate' ? '' : context.originalOperation?.action === 'seconds' ? context.batchReview : [...new Set([...checkReasons(project, operation), context.batchReview].filter(Boolean))].join('\n')
}
