import { parseReviewResult, formatReviewIssue } from '../../shared/review-result.js'
import { runStep, activeStep, stepAttempt, saveTaskDraft } from '../data/task-store.js'
import { runTextRequest } from './text-request.js'
import { skillLogPurpose } from './chat.js'
import { checkContext } from '../data/operation-context.js'
import { executeSteps } from '../../shared/steps.js'

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

export function textSteps({ target = null, phase, labelPrefix, prompts, options = {}, complete, canPersist, canRevise = () => true, initialText, persist, check, retainFailedDraft = false }) {
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
  const review = (kind, stage) => state => {
    const revision = state.revisionBase == null ? undefined : {
      baseContent: state.revisionBase, revisionOpinion: state.revisionOpinion, revisionReview: true,
    }
    return reviewStep({ kind, target, ...detail(kind), message: prompts.review?.(state.text, revision), check, text: state.text,
      options: { ...options, logStage: stage }, persist: result => save(state.text, result.check) }).then(result => {
      if (ctx) ctx.validation = result.check.failures
      return result
    })
  }
  const hasReview = Boolean(check || prompts.review)
  return [
    { name: 'text', when: () => initialText == null, run: () => generateStep({ target, ...detail('generate'), message: prompts.generation, options: { ...options, logStage: '生成' }, complete, persist: save }) },
    { name: 'review', when: () => hasReview, run: state => review('review', '自审')({ text: state.text ?? initialText }) },
    { name: 'revised', when: state => state.review?.review.passed === false && Boolean(prompts.revision) && canRevise(state.text ?? initialText), run: state => generateStep({ kind: 'revise', target, ...detail('revise'), message: prompts.revision(state.text ?? initialText, JSON.stringify(state.review.review)), options: { ...options, logStage: '自动修订' }, complete, persist: save }) },
    { name: 'reReview', when: state => state.revised != null, run: state => review('re_review', '复审')({ text: state.revised, revisionBase: state.text ?? initialText, revisionOpinion: JSON.stringify(state.review.review) }) },
  ]
}

export async function runTextSteps(spec) {
  const state = await executeSteps(textSteps(spec), { text: spec.initialText })
  const final = state.reReview || state.review || { review: null, reviewText: '', check: { passed: null, failures: [] } }
  const text = state.revised ?? state.text
  if (!canPublish(spec, text)) throw Object.assign(new Error(`自审未通过：${final.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return { ...final, text }
}
