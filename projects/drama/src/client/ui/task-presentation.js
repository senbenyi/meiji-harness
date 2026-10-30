import {stepExecutionName} from '../../shared/execution_activity.js'
/** 历史只读业务适配；只从当次记录恢复输入，不读取现在的项目Model。 */
export const taskHistoryPresentation = {
  stepName:stepExecutionName,
  review(step) {
    const review = step.result?.review
    if (step.kind !== 'review' || !['done', 'rejected'].includes(step.step_status)
      || !['content_issue', 'upstream_issue', 'rule_conflict'].includes(review?.status)) return {}
    return {
      rejected: true,
      type: { content_issue: '内容问题', upstream_issue: '上游资料问题', rule_conflict: '规则冲突' }[review.status],
      reason: (review.issues || []).map(issue => `${issue.location ? `${issue.location}：` : ''}${issue.reason || ''}${issue.suggestion ? `；${issue.suggestion}` : ''}`).join('\n'),
    }
  },
  taskOutput(task, steps) {
    if (['queued', 'running'].includes(task.task_status)) return { result: null }
    return {result:steps.filter(step=>step.step_status==='done').at(-1)?.result??null}
  },
  inputDependencies(task, steps) {
    const metadata = task.metadata || {}
    return {project_id:metadata.project_id,payload_ref:metadata.payload_ref||metadata.input_ref}
  },
}
