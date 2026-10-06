import { reviseStep } from '../steps/shared/text-revise.js'
import { generateStep } from '../steps/shared/text-generate.js'
import { reviewStep, programFailures } from '../steps/shared/text-review.js'
import { skillLogPurpose } from '../../gateway/model-gateway.js'
import { activeNode } from '../../runtime/task-context.js'
import { saveTaskDraft } from '../../data/content-records.js'
import { checkContext } from '../../runtime/operation-context.js'
import { maxRevisionsOf, roundSuffix } from '../../../shared/task-nodes.js'

function canPublish({ check, canPersist, retainFailedDraft }, text) {
  try { return (!canPersist || canPersist(text)) && (retainFailedDraft || programFailures(check, text).length === 0) }
  catch { return false }
}

export async function runTextNodes(spec) {
  const { target = null, phase, labelPrefix, prompts, complete, canPersist, canRevise = () => true, initialText, persist, check, retainFailedDraft = false } = spec
  let options = spec.options || {}
  const detail = (kind, round) => ({ phase, round, label: labelPrefix ? `${labelPrefix}·${({ generate: '生成', review: '自审', revise: '修订', re_review: '复审' })[kind]}${roundSuffix({ kind, round })}` : undefined })
  const ctx = checkContext.getStore()
  // 修订上限：调用方显式传入优先，其次为当前任务定义（任务执行器放入上下文），默认 2。
  // 操作上下文可按目标给出各任务的上限（一个操作含多个任务时）。
  const maxRevisions = maxRevisionsOf(spec.maxRevisions ?? (typeof ctx?.maxRevisions === 'function' ? ctx.maxRevisions(target) : ctx?.maxRevisions))
  options = { ...options, signal: options.signal || ctx?.signal, logPurpose: options.logPurpose || skillLogPurpose(prompts.generation.skill) }
  const save = async (text, verdict) => {
    if (!canPublish({ check, canPersist, retainFailedDraft }, text)) {
      // 保存可追查的原文及结论，不用无法映射的内容覆盖项目。
      if (activeNode()) await saveTaskDraft(target, { text, check: verdict })
      return false
    }
    if (ctx) ctx.validation = verdict.failures
    return persist ? await persist(text, verdict) : false
  }
  const review = async (text, kind, stage, revision, round) => {
    const result = await (ctx?.steps?.review || reviewStep)({ prompts, revision, kind, target, ...detail(kind, round), message: prompts.review?.(text, revision), check, text,
      options: { ...options, logStage: stage }, persist: result => save(text, result.check) })
    if (ctx) ctx.validation = result.check.failures
    return result
  }
  let text = initialText
  if (text == null) text = await (ctx?.step === 'revise' ? ctx?.steps?.revise || reviseStep : ctx?.steps?.generate || generateStep)({ prompts, target, ...detail(ctx?.step === 'revise' ? 'revise' : 'generate'), message: prompts.generation,
    options: { ...options, logStage: '生成' }, complete, persist: save })
  if (['generate', 'revise'].includes(ctx?.step)) {
    if (!canPublish(spec, text)) throw Object.assign(new Error('生成结果格式无效，无法保存'), { code: 'CONTENT_CHECK_FAILED', status: 422 })
    return { text, review: null, reviewText: '', check: { passed: null, failures: [] } }
  }
  let final = { review: null, reviewText: '', check: { passed: null, failures: [] } }
  if (check || prompts.review) final = await review(text, 'review', '自审')
  // 自审不通过且仍有修订次数时，追加一轮「修订 → 复审」；每轮基于本轮最新失败稿和本轮审核意见。
  for (let round = 1; final.review?.passed === false && prompts.revision && round <= maxRevisions && canRevise(text); round++) {
    const baseContent = text, revisionOpinion = JSON.stringify(final.review)
    text = await (ctx?.steps?.revise || reviseStep)({ prompts, baseContent, revisionOpinion, target, ...detail('revise', round), message: prompts.revision(baseContent, revisionOpinion),
      options: { ...options, logStage: '自动修订' }, complete, persist: save })
    final = await review(text, 're_review', '复审', { baseContent, revisionOpinion, revisionReview: true }, round)
  }
  if (!canPublish(spec, text)) throw Object.assign(new Error(`自审未通过：${final.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return { ...final, text }
}
