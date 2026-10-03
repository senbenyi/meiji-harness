// 所有 AI 审核共用的返回协议与响应契约；审核结果的格式只在这里定义，各 Model 不再另写返回规则。
export const reviewProtocol = `返回一个 JSON 对象，只含 passed 和 issues 两个字段：
- 通过时：{"passed":true,"issues":[]}
- 未通过时：passed 为 false，issues 逐项列出每个实际问题，每项含三个字段——location（具体小节、字段或镜头编号）、reason（引用待审内容与对应的输入事实或审核标准，说明问题）、requirement（最小修正要求）。每个问题单独一项；镜头相关问题按镜头编号分别列出，跨镜问题在 location 中写明相关编号。
issues 的文字使用本次要求中的输出语言。

示例（仅示范格式）：
{"passed":false,"issues":[{"location":"结尾状态","reason":"待审稿写「信已烧毁」，但输入资料要求保留信件","requirement":"保留信件并同步相关持物状态"}]}`

export function parseReviewResult(text) {
  const invalid = () => new Error('审核返回格式错误：必须返回 passed 布尔值及 issues 问题数组，且结论与问题一致')
  let result
  try { result = JSON.parse(text) } catch { throw invalid() }
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  const keys = ['location', 'reason', 'requirement']
  if (!exact(result, ['passed', 'issues']) || typeof result.passed !== 'boolean' || !Array.isArray(result.issues)
    || result.passed !== (result.issues.length === 0)
    || result.issues.some(issue => !exact(issue, keys) || keys.some(key => typeof issue[key] !== 'string' || !issue[key].trim()))) throw invalid()
  return { passed: result.passed, issues: result.issues.map(issue => Object.fromEntries(keys.map(key => [key, issue[key].trim()]))) }
}

export const formatReviewIssue = issue => `位置：${issue.location}；原因：${issue.reason}；修正要求：${issue.requirement}`
