// 审核记录沿用原结构；编排时恢复标准问题字段，来源只按程序固定标签判定。
export function splitSecondsIssues(values = []) {
  if (typeof values === 'string') {
    const original = values
    try { values = JSON.parse(values).issues } catch { values = null }
    if (!Array.isArray(values)) values = [original]
  }
  const groups = { programIssues: [], semanticIssues: [] }, seen = new Set()
  for (const value of values || []) {
    if (!value) continue
    const match = typeof value === 'string' && /^位置：([\s\S]*?)；原因：([\s\S]*?)；修正要求：([\s\S]*)$/.exec(value)
    const issue = typeof value === 'object' ? value : match
      ? { location: match[1], reason: match[2], requirement: match[3] }
      : { location: '本次内容', reason: String(value), requirement: '对照已通过镜头表作最小修正' }
    const key = JSON.stringify(issue)
    if (seen.has(key)) continue
    seen.add(key)
    groups[issue.location === '程序校验' ? 'programIssues' : 'semanticIssues'].push(issue)
  }
  return groups
}
