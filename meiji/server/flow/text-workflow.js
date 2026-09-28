import { runTextRequest } from '../workers/text-request-worker.js'
import { skillLogPurpose } from '../generate/chat.js'
import { checkContext } from '../data/self-checks.js'

export async function runGenerationNode({ message, options, validate = () => {}, persist }) {
  const text = await runTextRequest(message, options)
  if (!String(text || '').trim()) throw new Error('模型未返回内容')
  validate(text)
  if (persist) await persist(text, { passed: null, failures: [] })
  return text
}

export async function runReviewNode({ message, options }) {
  const reviewText = String(await runTextRequest(message, options)).trim()
  const passed = reviewText === 'PASS'
  return { reviewText, check: { passed, failures: passed ? [] : [reviewText || '审核返回为空'] } }
}

// 流程层调度独立节点。自审失败最多修订一次，worker 本身不循环。
export async function runTextWorkflow({ prompts, options, validate = () => {}, canRevise = () => true, initialText, persist }) {
  const ctx = checkContext.getStore()
  options = { ...options, signal: options.signal || ctx?.signal,
    logPurpose: options.logPurpose || skillLogPurpose(prompts.generation.skill) }
  const save = persist && (async (text, check) => {
    const deferred = ctx?.deferCheckFailure
    if (ctx) { ctx.deferCheckFailure = true; ctx.textNodeSaving = true; ctx.validation = check.failures }
    try {
      await persist(text, check)
      if (ctx) ctx.textDraftSaved = true
    } finally { if (ctx) { ctx.deferCheckFailure = deferred; ctx.textNodeSaving = false } }
  })
  let text = initialText ?? await runGenerationNode({ message: prompts.generation, options: { ...options, logStage: '生成' }, validate, persist: save })
  const history = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runReviewNode({ message: prompts.review(text), options: { ...options, logStage: attempt ? '复审' : '自审' } })
    history.push({ attempt: attempt + 1, reviewText: result.reviewText, passed: result.check.passed })
    if (ctx) { ctx.validation = result.check.failures; ctx.reviewHistory = history }
    if (save) await save(text, result.check)
    if (result.check.passed || attempt === 1 || !/^FAIL\s+\S/.test(result.reviewText) || !canRevise(text)) return { ...result, text, history }
    text = await runGenerationNode({ message: prompts.revision(text, result.reviewText), options: { ...options, logStage: '自动修订' }, validate, persist: save })
  }
}
