/** 仅记录本任务的审阅事实和字段变化，不判定问题是否解决，也不复制旧版分镜全文。 */
export function changedShotFields(before, after) {
  const previous = new Map((before?.shots || []).map(row => [row.id, row]))
  const current = new Map((after?.shots || []).map(row => [row.id, row]))
  const changes = []
  for (const [id, row] of current) {
    const old = previous.get(id)
    if (!old) { changes.push({ shot_id: id, change: 'added', fields: Object.keys(row).filter(key => key !== 'id') }); continue }
    const fields = [...new Set([...Object.keys(old), ...Object.keys(row)])].filter(key => key !== 'id' && JSON.stringify(old[key]) !== JSON.stringify(row[key]))
    if (fields.length) changes.push({ shot_id: id, change: 'modified', fields })
  }
  for (const id of previous.keys()) if (!current.has(id)) changes.push({ shot_id: id, change: 'removed', fields: [] })
  return changes
}

export function shotReviewHistory(previousResults, { retryIssues, initialOutput } = {}) {
  const generated = row => ['generate', 'revise'].includes(row.kind) && row.result?.output
  const history = []
  if (retryIssues?.length) {
    const revised = previousResults.find(generated)
    history.push({ source: 'retry', round: null, status: 'content_issue', issues: structuredClone(retryIssues),
      revision: { applied: !!revised, changed_fields: revised ? changedShotFields(initialOutput, revised.result.output) : [] } })
  }
  for (const [index, row] of previousResults.entries()) {
    if (!row.result?.review) continue
    const before = previousResults.slice(0, index).findLast(generated)?.result.output
    const after = previousResults.slice(index + 1).find(generated)?.result.output
    history.push({ source: 'current_task', round: row.round, status: row.result.review.status, issues: structuredClone(row.result.review.issues),
      revision: { applied: !!after, changed_fields: after ? changedShotFields(before, after) : [] } })
  }
  return history
}
