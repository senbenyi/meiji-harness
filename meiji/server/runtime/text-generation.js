import { h3PromptFailures } from '../../shared/video-rules.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { buildEditedContentReview } from '../prompts/text-prompts.js'
import { runStep, stepAttempt } from './task-execution.js'
import { runTextRequest, skillLogPurpose } from '../gateway/model-gateway.js'
import { parseReviewResult, formatReviewIssue } from '../../shared/review-result.js'
import { activeStep } from './task-context.js'
import { saveTaskDraft } from '../data/content-records.js'
import { checkContext } from './operation-context.js'

export async function reviewContent({ project, stage, shotId, text, route, request }) {
  const board = project.shots?.items.find(shot => shot.id === shotId)?.storyboard.content
  const check = stage === 'storyboard' && board ? value => h3PromptFailures(value, shotReferenceImages(project, board), board.video) : undefined
  const result = await reviewStep({ check, text, target: shotId ? `storyboard:${shotId}` : 'story', message: buildEditedContentReview({ project, stage, shotId }, text), options: { project, route, request, logStage: '自审' } })
  return result.check
}

// check 是流程提供的内容验收函数；既可返回问题数组，也可抛出解析/匹配错误。
function programFailures(check, text) {
  if (!check) return []
  try { return check(text) }
  catch (error) { if (error.name === 'AbortError') throw error; return [error.message] }
}

function canPublish({ check, canPersist, retainFailedDraft }, text) {
  try { return (!canPersist || canPersist(text)) && (retainFailedDraft || programFailures(check, text).length === 0) }
  catch { return false }
}

export async function generateStep({ kind = 'generate', target = null, phase, label, message, options, complete, persist }) {
  return runStep(kind, async () => {
    let text = await runTextRequest(message, options)
    if (!String(text || '').trim()) throw new Error('模型未返回内容')
    if (complete) text = await complete(text, message, options)
    if (persist && await persist(text, { passed: null, failures: [] }) !== false) markSaved()
    return text
  }, { target, phase, label })
}

// 一个自审包含按流程声明的0–2种来源；接口故障或非法审核响应仍是执行错误。
export async function reviewStep({ kind = 'review', target = null, phase, label, message, options, persist, check, text }) {
  if (!check && !message) return { review: null, reviewText: '', check: { passed: null, failures: [] } }
  return runStep(kind, async () => {
    const failures = check ? await stepAttempt('程序审核', () => programFailures(check, text)) : []
    const model = message ? await stepAttempt('大模型审核', async () => parseReviewResult(await runTextRequest(message, options))) : null
    const issues = [...(model?.issues || []), ...failures.map(reason => ({ location: '程序校验', reason, requirement: '按该校验要求修正正文' }))]
    const review = { passed: issues.length === 0, issues }
    const combined = issues.map(formatReviewIssue)
    const result = { review, reviewText: combined.join('\n') || '审核通过', check: { passed: review.passed, failures: combined } }
    if (persist && await persist(result) !== false) markSaved()
    return result
  }, { target, phase, label })
}

function markSaved() {
  const step = activeStep()
  if (step) step.saved = true
}

export async function runTextSteps(spec) {
  const { target = null, phase, labelPrefix, prompts, complete, canPersist, canRevise = () => true, initialText, persist, check, retainFailedDraft = false } = spec
  let options = spec.options || {}
  const detail = kind => ({ phase, label: labelPrefix ? `${labelPrefix}·${({ generate: '生成', review: '自审', revise: '修订', re_review: '复审' })[kind]}` : undefined })
  const ctx = checkContext.getStore()
  options = { ...options, signal: options.signal || ctx?.signal, logPurpose: options.logPurpose || skillLogPurpose(prompts.generation.skill) }
  const save = async (text, verdict) => {
    if (!canPublish({ check, canPersist, retainFailedDraft }, text)) {
      // 保存可追查的原文及结论，不用无法映射的内容覆盖项目。
      if (activeStep()) await saveTaskDraft(target, { text, check: verdict })
      return false
    }
    if (ctx) ctx.validation = verdict.failures
    return persist ? await persist(text, verdict) : false
  }
  const review = async (text, kind, stage, revision) => {
    const result = await reviewStep({ kind, target, ...detail(kind), message: prompts.review?.(text, revision), check, text,
      options: { ...options, logStage: stage }, persist: result => save(text, result.check) })
    if (ctx) ctx.validation = result.check.failures
    return result
  }
  let text = initialText
  if (text == null) text = await generateStep({ target, ...detail('generate'), message: prompts.generation,
    options: { ...options, logStage: '生成' }, complete, persist: save })
  let final = { review: null, reviewText: '', check: { passed: null, failures: [] } }
  if (check || prompts.review) final = await review(text, 'review', '自审')
  if (final.review?.passed === false && prompts.revision && canRevise(text)) {
    const baseContent = text, revisionOpinion = JSON.stringify(final.review)
    text = await generateStep({ kind: 'revise', target, ...detail('revise'), message: prompts.revision(baseContent, revisionOpinion),
      options: { ...options, logStage: '自动修订' }, complete, persist: save })
    final = await review(text, 're_review', '复审', { baseContent, revisionOpinion, revisionReview: true })
  }
  if (!canPublish(spec, text)) throw Object.assign(new Error(`自审未通过：${final.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return { ...final, text }
}
