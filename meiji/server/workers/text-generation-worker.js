import { askSkill, textMaxTokens, skillLogPurpose } from '../generate/chat.js'
import { buildGenerationPrompt, buildSelfReviewPrompt } from '../prompts/build-generation-prompts.js'
import { skillSupplement } from '../data/custom-skills.js'
import { checkContext, withReviewPrompt, markApiFailure } from '../data/self-checks.js'

export async function runTextGeneration({ skill, instructions, options, validate = () => {}, canRevise, reviewContext = '', reviewInstructions = instructions, initialText }) {
  options = { ...options, signal: options.signal || checkContext.getStore()?.signal }
  const invoke = options.request || askSkill
  const request = async (...args) => { try { return await invoke(...args) } catch (error) { throw markApiFailure(error) } }
  let reviewAttempt = 0
  const logPurpose = skillLogPurpose(skill)
  const result = await generateWithSelfReview({
    generate: async correction => {
      options.signal?.throwIfAborted()
      const prompt = buildGenerationPrompt({ instructions: withReviewPrompt(instructions), correction })
      const text = await request(skill, prompt, { ...options, logPurpose, logStage: correction ? '自动修订' : '生成', maxTokens: options.maxTokens || textMaxTokens(options.project.durationSeconds) })
      validate(text)
      return text
    },
    canRevise, initialText,
    review: text => request('skill-gongyong-content-review', buildSelfReviewPrompt({ skill, instructions: withReviewPrompt(reviewInstructions, false) + skillSupplement(options.project, skill), content: text, extraContext: reviewContext }), { ...options, logPurpose, logStage: reviewAttempt++ ? '复审' : '自审', includeReview: false, json: false, maxTokens: 8192 }),
  })
  const ctx = checkContext.getStore()
  if (ctx) { ctx.validation = result.check.failures; ctx.reviewHistory = result.history }
  return result
}

// 一次工具执行最多生成两次；由服务端控制，不依赖聊天模型自行再次调用工具。
async function generateWithSelfReview({ generate, review, canRevise = () => true, initialText }) {
  const history = []
  let text = initialText ?? await generate()
  if (!String(text || '').trim()) throw Object.assign(new Error('模型未返回内容'), { status: 502 })
  for (let attempt = 0; attempt < 2; attempt++) {
    const reviewText = String(await review(text)).trim()
    history.push({ attempt: attempt + 1, reviewText, passed: reviewText === 'PASS' })
    const passed = reviewText === 'PASS'
    const result = { history, text, reviewText, check: { passed, failures: passed ? [] : [reviewText || '审核返回为空'] } }
    // 仅明确的语义 FAIL 可触发修订；异常/无效审核协议和传输格式错误不重试。
    if (passed || attempt === 1 || !/^FAIL\s+\S/.test(reviewText) || !canRevise(text)) return result
    const revised = await generate({ text, reviewText })
    if (!String(revised || '').trim()) throw new Error('模型未返回修订内容')
    text = revised
  }
}
