import { runNode, nodeAttempt } from '../../../runtime/step-execution.js'
import { runTextRequest } from '../../../gateway/model-gateway.js'
import { parseReviewResult, formatReviewIssue } from '../../../../shared/review-result.js'
import { activeNode } from '../../../runtime/task-context.js'

// check 是流程提供的内容验收函数；既可返回问题数组，也可抛出解析/匹配错误。
export function programFailures(check, text) {
  if (!check) return []
  try { return check(text) }
  catch (error) { if (error.name === 'AbortError') throw error; return [error.message] }
}

export async function reviewStep({ kind = 'review', target = null, phase, label, round, message, options, persist, check, text }) {
  if (!check && !message) return { review: null, reviewText: '', check: { passed: null, failures: [] } }
  return runNode(kind, async () => {
    const failures = check ? await nodeAttempt('程序审核', () => programFailures(check, text)) : []
    const model = message ? await nodeAttempt('大模型审核', async () => parseReviewResult(await runTextRequest(message, options))) : null
    const issues = [...(model?.issues || []), ...failures.map(reason => ({ location: '程序校验', reason, requirement: '按该校验要求修正正文' }))]
    const review = { passed: issues.length === 0, issues }
    const combined = issues.map(formatReviewIssue)
    const result = { review, reviewText: combined.join('\n') || '审核通过', check: { passed: review.passed, failures: combined } }
    if (persist && await persist(result) !== false) markSaved()
    return result
  }, { target, phase, label, round })
}

function markSaved() {
  const step = activeNode()
  if (step) step.saved = true
}

