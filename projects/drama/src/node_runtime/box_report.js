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
  const candidate = ['script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'costume_image'].includes(task.node_type) ? detail.steps.findLast(step => step.result?.output)?.result.output : null
  const basicOutput = task.node_type === 'project' ? detail.steps.findLast(step => step.kind === 'extract_summary' && step.result?.output)?.result.output : null
  const created = detail.steps.findLast(step => step.result?.created)?.result.created
  const originalSummary = detail.steps.findLast(step => step.result?.original_script_summary)?.result.original_script_summary
  const warning = detail.steps.findLast(step => step.result?.summary_error)?.result.summary_error
  const changed = detail.steps.findLast(step => step.result?.changed)?.result
  const decision = detail.status === 'completed' ? 'passed'
    : detail.status === 'cancelled' ? 'cancelled'
      : detail.status === 'rejected' ? review?.status || 'content_issue' : 'failed'
  const saved = Boolean(created || changed || candidate && detail.status === 'completed' || detail.steps.some(step => step.result?.saved))
  return {
    report_id: detail.group.id, group_id: detail.group.id, task_id: task.id,
    project_id: metadata.project_id, session_id: created ? metadata.target_session_id : metadata.session_id || metadata.source_session_id,
    source_session_id: metadata.source_session_id || metadata.session_id,
    node_type: task.node_type, action: task.action, status: detail.status, decision,
    requires_user_decision: ['script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'costume_image'].includes(task.node_type) && (detail.status === 'failed' || detail.status === 'rejected' && decision === 'content_issue'),
    goal: metadata.goal || metadata.instruction || '创建项目',
    reason: detail.status === 'rejected' && review ? review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n') : detail.reason || '',
    parent_group_id: metadata.parent_group_id || null,
    issues: structuredClone(review?.issues || []),
    related_nodes: decision === 'upstream_issue' ? ['scene_extraction', 'group_setting'].includes(task.node_type) ? ['story_segments'] : task.node_type === 'character_extraction' ? ['group_setting', 'story_segments'] : task.node_type === 'story_segments' ? ['script_revision'] : ['project'] : decision === 'rule_conflict' ? [task.node_type] : [],
    saved, result_reference: created ? '#/basic_info' : candidate && saved ? task.node_type === 'scene_extraction' ? '#/scene_extraction/scenes' : task.node_type === 'group_setting' ? '#/group_setting/groups' : task.node_type === 'character_extraction' ? '#/character_extraction/characters' : task.node_type === 'costume_image' ? '#/character_extraction/assets' : task.node_type === 'story_segments' ? '#/story_segments/segments' : '#/basic_info/actual_script' : changed?.reference || null,
    ...(created ? { result: created } : {}),
    ...(basicOutput ? { summary: basicOutput.summary, estimated_duration_seconds: basicOutput.estimated_duration_seconds, output: basicOutput } : originalSummary ? { summary: originalSummary } : {}),
    ...(warning ? { warning } : {}),
    ...(candidate ? { summary: candidate.summary, estimated_duration_seconds: candidate.estimated_duration_seconds,
      review_packet: { goal: metadata.goal || metadata.instruction, instruction: metadata.instruction,
        ...structuredClone(metadata.input_snapshot || {}), candidate: structuredClone(candidate) } } : {}),
  }
}

/** 重试决策来自面板点击；模型Tool不可将自身调用伪装为用户选择。 */
export function userRetry(parent, { source, action }) {
  if (action === undefined) return null
  if (source !== 'ui' || !['continue', 'regenerate'].includes(action) || !parent || !boxReport(parent).requires_user_decision)
    throw new Error('需由用户选择内容审核失败任务的继续修改或重新生成')
  const candidate = parent.steps.findLast(step => step.result?.output)?.result.output
  if (action === 'continue' && !candidate) throw new Error('没有可继续修改的有效结果，请选择重新生成')
  return { candidate: structuredClone(candidate || null), issues: structuredClone(parent.steps.findLast(step => step.result?.review)?.result.review.issues || []) }
}
