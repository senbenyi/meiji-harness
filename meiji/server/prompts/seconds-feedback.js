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

// 语义问题只使用 location 中的镜头；程序问题的镜头 ID 位于 reason。
// 没有明确位置时修订整集，避免从建议或参考事件中猜出错误范围。
export function secondsRevisionIds(review, shots) {
  const { programIssues, semanticIssues } = splitSecondsIssues(review)
  const ids = new Set()
  for (const [issues, field] of [[programIssues, 'reason'], [semanticIssues, 'location']]) for (const issue of issues) {
    const matches = issue[field].match(/\bS\d{2,}\b/g) || []
    if (!matches.length || matches.some(id => !shots.some(shot => shot.id === id))) return shots.map(shot => shot.id)
    for (const id of matches) ids.add(id)
  }
  return shots.filter(shot => ids.has(shot.id)).map(shot => shot.id)
}
