import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'

const invalid = message => { throw Object.assign(new TypeError(`分镜审核证据无效：${message}`), { code: 'INVALID_SHOT_REVIEW' }) }

function atPath(root, path, candidateOnly = false) {
  if (typeof path !== 'string' || !path.startsWith('/') || candidateOnly && !path.startsWith('/current_shots/')) invalid(`路径不可用：${path}`)
  const allowed = ['story_outline', 'scene_extraction', 'group_setting', 'character_extraction', 'current_shots', 'rules']
  const parts = path.slice(1).split('/')
  if (!allowed.includes(parts[0])) invalid(`依据不属于本次资料：${path}`)
  let value = root
  for (const part of parts) {
    if (/~(?![01])/u.test(part)) invalid(`路径转义错误：${path}`)
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) invalid(`路径不存在：${path}`)
    value = value[key]
  }
  return value
}

function strings(value) {
  if (typeof value === 'string') return [value]
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
}

function quoted(root, path, quote, candidateOnly = false) {
  const values = strings(atPath(root, path, candidateOnly))
  if (quote && !values.some(value => value.includes(quote))) invalid(`引用不是当前原文：${path}；${quote}`)
  return values
}

/** 只验证证据确实来自本次输入，不以程序猜测语义；无效审核必须重审，不能自动通过。 */
export function parseShotReview(response, input, rules) {
  const review = parseNodeOutput('shot_design', 'review', response)
  const root = { ...input, rules: rules.rules }, previous = input.previous_issues || []
  const checks = new Map()
  for (const check of review.previous_issue_checks) {
    if (check.issue_index >= previous.length || checks.has(check.issue_index)) invalid('旧问题核对索引越界或重复')
    quoted(root, check.candidate_path, check.candidate_quote, true)
    checks.set(check.issue_index, check)
  }
  if (checks.size !== previous.length) invalid('必须逐项核对上一轮问题')
  for (const issue of review.issues) {
    const sources = quoted(root, issue.source_path, issue.source_quote)
    const candidate = quoted(root, issue.candidate_path, issue.candidate_quote, true)
    if (!issue.candidate_quote && !['omission', 'dialogue'].includes(issue.category)) invalid('非遗漏问题必须引用当前错误内容')
    const shotPath = issue.candidate_path.match(/^\/current_shots\/shots\/\d+(?=\/|$)/u)?.[0]
    const related = shotPath ? strings(atPath(root, shotPath, true)) : candidate
    if (!issue.candidate_quote && related.some(value => value.includes(issue.source_quote))) invalid('声称遗漏的原文已在当前候选中，不能要求跨字段重复表达')
    const dialogueQuote = issue.source_quote.replace(/^[“「『"]|[”」』"]$/gu, '')
    if (issue.category === 'dialogue' && (!dialogueQuote.trim() || !sources.some(value => [
      ...value.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu),
      ...value.matchAll(/(?:^|\n)[^\n：:]{1,30}[：:][ \t]*([^\n“”「」『』"]+)/gu),
    ].some(match => match[1].includes(dialogueQuote))))) invalid('对白依据必须来自明确逐字对白，不能把概述当定稿原话')
    if (issue.previous_issue_index !== null) {
      const index = issue.previous_issue_index
      if (checks.get(index)?.state !== 'unresolved') invalid('已解决或不存在的旧问题不得再次阻断')
    } else if (previous.some(old => old.category === issue.category && old.source_path === issue.source_path
      && old.source_quote === issue.source_quote && old.candidate_path === issue.candidate_path)) invalid('重复旧问题必须关联对应索引，不能伪装成新问题')
  }
  for (const [index, check] of checks) if (check.state === 'unresolved' && !review.issues.some(issue => issue.previous_issue_index === index)) invalid('未解决旧问题必须给出本轮有据的阻断项')
  return review
}
