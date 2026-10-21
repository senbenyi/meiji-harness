/** 等待程序盒子终态；取消归任务管理器处理，不把未完成结果当成功。 */
export async function waitBoxTask(records, groupId, signal) {
  if (!records.tasks.detail(records.scope, groupId)) throw new Error('任务不存在')
  await new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const cleanup = () => { unsubscribe(); signal?.removeEventListener('abort', abort) }
    const check = () => {
      const detail = records.tasks.detail(records.scope, groupId)
      if (!['queued', 'running'].includes(detail.status)) { cleanup(); resolve() }
    }
    const abort = () => { records.tasks.cancel(records.scope, groupId, '会话调用已取消'); cleanup(); reject(signal.reason || new Error('已取消')) }
    unsubscribe = records.tasks.store.subscribe(scope => { if (scope === records.scope) check() })
    if (signal?.aborted) abort()
    else { signal?.addEventListener('abort', abort, { once: true }); check() }
  })
  return boxReport(records.tasks.detail(records.scope, groupId))
}

/** 报告只取任务保存的事实，不读取可能已经变化的项目来伪造旧执行结果。 */
export function boxReport(detail) {
  const task = detail.tasks[0], metadata = task.metadata
  const review = detail.steps.findLast(step => step.result?.review)?.result.review
  const candidate = detail.steps.findLast(step => step.result?.output)?.result.output
  const created = detail.steps.findLast(step => step.result?.created)?.result.created
  const changed = detail.steps.findLast(step => step.result?.changed)?.result
  const decision = detail.status === 'completed' ? 'passed'
    : detail.status === 'cancelled' ? 'cancelled'
      : detail.status === 'rejected' ? review?.status || 'content_issue' : 'failed'
  return {
    report_id: detail.group.id, group_id: detail.group.id, task_id: task.id,
    project_id: metadata.project_id, session_id: created ? metadata.target_session_id : metadata.session_id || metadata.source_session_id,
    source_session_id: metadata.source_session_id || metadata.session_id,
    node_type: task.node_type, action: task.action, status: detail.status, decision,
    goal: metadata.goal || metadata.instruction || '创建项目', reason: detail.reason || '',
    parent_group_id: metadata.parent_group_id || null,
    issues: structuredClone(review?.issues || []),
    related_nodes: decision === 'upstream_issue' ? ['project'] : decision === 'rule_conflict' ? [task.node_type] : [],
    saved: Boolean(created || candidate || changed), result_reference: created ? '#/basic_info' : candidate ? '#/script_revision/output' : changed?.reference || null,
    ...(created ? { result: created } : {}),
    ...(candidate ? { summary: candidate.summary, estimated_duration_seconds: candidate.estimated_duration_seconds,
      review_packet: { goal: metadata.goal || metadata.instruction, instruction: metadata.instruction,
        ...structuredClone(metadata.input_snapshot || {}), candidate: structuredClone(candidate) } } : {}),
  }
}
