import { NodeStateModel } from '@agent-modules/task/models'
import { nodeState } from './node_state.js'

/** 结束摘要从Task事实恢复；按受理顺序取最新终态，迟到通知不携带旧状态覆盖项目。 */
export function projectExecutions(records, projectId) {
  if (!records) return []
  const latest = new Map()
  for (let offset = 0; ; offset += 200) {
    const page = records.tasks.history(records.scope, { unit: 'task', offset, limit: 200 })
    for (const task of page.tasks) {
      if (task.metadata.project_id !== projectId || ['queued', 'running'].includes(task.task_status)) continue
      const type = task.node_type
      if (!['project', 'script_revision', 'story_segments'].includes(type)) continue
      if (!latest.has(type) || latest.get(type).queue_order < task.queue_order) latest.set(type, task)
    }
    if (offset + page.tasks.length >= page.total) break
  }
  return [...latest.values()].map(task => {
    const detail = records.tasks.detail(records.scope, task.group_id)
    const steps = detail.steps.filter(step => step.task_id === task.id)
    const explicit = steps.findLast(step => step.result?.stop_code)?.result.stop_code
    const review = steps.findLast(step => step.result?.review)?.result.review
    const failed = steps.findLast(step => step.step_status === 'failed')
    const requestFailed = failed?.http?.some(row => row.ok === false)
    const stop_code = task.task_status === 'completed' ? 'completed'
      : task.task_status === 'cancelled' ? 'cancelled'
      : task.task_status === 'failed' ? requestFailed ? 'request_failed' : 'execution_error'
      : explicit || (['rule_conflict', 'upstream_issue', 'content_issue'].includes(review?.status) ? review.status : 'validation_failed')
    const warning = steps.findLast(step => step.result?.summary_error)?.result.summary_error
    return { type: task.node_type, execution: {
      task_id: task.id, status: task.task_status, stop_code,
      message: task.end_reason || (task.task_status === 'completed' ? `${task.name}已完成${warning ? `；${warning}` : ''}` : '执行已停止'),
      finished_at: task.ended_at,
    } }
  })
}

export function applyExecutionStates(project, executions) {
  for (const { type, execution } of executions) {
    const state = nodeState(project, type)
    if (!state) continue
    const changed = state.last_execution?.task_id !== execution.task_id
    if (changed && execution.status === 'rejected' && ['empty', 'rejected'].includes(state.status)) {
      state.status = 'rejected'; state.reason = execution.message
    }
    Object.assign(state, new NodeStateModel({ ...state, last_execution: execution }).toJSON())
  }
  return project
}

/** 轻量轮询字段不含动作规则、提示词或业务正文。 */
export function stateSummary(state) {
  const { type, status, reason, last_execution } = state
  return { type, status, reason, last_execution }
}
