// 文本步骤：生成 → 自审 →（自审不通过且可修订时）修订 → 复审。
// 编排以声明的步骤清单交给 shared/steps.js 的顺序执行器；每个步骤经 runStep 记录到当前任务，
// 与任务开始时写入的计划步骤按「种类 + 目标」对应。单步执行（generateStep / reviewStep）即文本 worker。
import { runStep, activeStep } from '../data/task-store.js'
import { runTextRequest } from './text-request.js'
import { skillLogPurpose } from './chat.js'
import { checkContext } from '../data/operation-context.js'
import { executeSteps } from '../../shared/steps.js'

// 生成或修订一次：请求、续传补全、格式校验、保存草稿（保存成功记在步骤上，供接口失败时判断是否回退）。
export async function generateStep({ kind = 'generate', target = null, phase, label, message, options, validate = () => {}, complete, persist }) {
  return runStep(kind, async () => {
    let text = await runTextRequest(message, options)
    if (!String(text || '').trim()) throw new Error('模型未返回内容')
    if (complete) text = await complete(text, message, options)
    validate(text)
    if (persist) { if (await persist(text, { passed: null, failures: [] }) !== false) markSaved() }
    return text
  }, { target, phase, label })
}

// 审核一次：必须返回 PASS 或「FAIL 原因」，否则为执行失败（审核返回格式错误）。
export async function reviewStep({ kind = 'review', target = null, phase, label, message, options, persist, failures = [] }) {
  return runStep(kind, async () => {
    const reviewText = String(await runTextRequest(message, options)).trim().split(/\n(?:整体|其他|补充)?建议[（(]非失败项[）)]\s*[:：]/)[0].trim()
    let passed = reviewText === 'PASS'
    if (!passed && !/^FAIL\s+\S/.test(reviewText)) throw new Error('审核返回格式错误')
    const combined = [...(passed ? [] : [reviewText]), ...failures]
    passed = combined.length === 0
    const result = { reviewText: failures.length ? `FAIL ${combined.join('；')}` : reviewText, check: { passed, failures: combined } }
    if (persist) { if (await persist(result) !== false) markSaved() }
    return result
  }, { target, phase, label })
}

function markSaved() {
  const step = activeStep()
  if (step) step.saved = true
}

const revisable = review => !review.check.passed && /^FAIL\s+\S/.test(review.reviewText)

// 声明文本步骤。target 为写入的内容节点（summary / story / shots / seconds / storyboard:S01 / image:C01 …）。
export function textSteps({ target = null, phase, labelPrefix, prompts, options, validate = () => {}, complete, canRevise = () => true, initialText, persist, check = () => [], retainFailedDraft = false }) {
  const detail = kind => ({ phase, label: labelPrefix ? `${labelPrefix}·${({ generate: '生成', review: '自审', revise: '修订', re_review: '复审' })[kind]}` : undefined })
  const ctx = checkContext.getStore()
  options = { ...options, signal: options.signal || ctx?.signal, logPurpose: options.logPurpose || skillLogPurpose(prompts.generation.skill) }
  const save = persist && (async (text, verdict) => {
    if (!retainFailedDraft && check(text).length) return false
    if (ctx) ctx.validation = verdict.failures
    await persist(text, verdict)
  })
  const review = (kind, stage) => state => {
    const revision = state.revisionBase == null ? undefined : {
      baseContent: state.revisionBase, revisionOpinion: state.revisionOpinion, revisionReview: true,
    }
    return reviewStep({ kind, target, ...detail(kind), message: prompts.review(state.text, revision), failures: check(state.text),
      options: { ...options, logStage: stage }, persist: save && (result => save(state.text, result.check)) }).then(result => {
      if (ctx) ctx.validation = result.check.failures
      return result
    })
  }

  return [
    { name: 'text', when: () => initialText == null, run: () => generateStep({ target, ...detail('generate'), message: prompts.generation, options: { ...options, logStage: '生成' }, validate, complete, persist: save }) },
    { name: 'review', run: state => review('review', '自审')({ text: state.text ?? initialText }) },
    { name: 'revised', when: state => revisable(state.review) && canRevise(state.text ?? initialText), run: state => generateStep({ kind: 'revise', target, ...detail('revise'), message: prompts.revision(state.text ?? initialText, state.review.reviewText), options: { ...options, logStage: '自动修订' }, validate, complete, persist: save }) },
    { name: 'reReview', when: state => state.revised != null, run: state => review('re_review', '复审')({ text: state.revised, revisionBase: state.text ?? initialText, revisionOpinion: state.review.reviewText }) },
  ]
}

// 执行文本步骤，返回最终正文与审核结论（与原 runTextWorkflow 的返回一致）。
export async function runTextSteps(spec) {
  const state = await executeSteps(textSteps(spec), { text: spec.initialText })
  const final = state.reReview || state.review
  return { ...final, text: state.revised ?? state.text }
}
