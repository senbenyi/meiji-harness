import { history as project } from '../../node_box/project/ui/conversation/history.js'
import { history as script, rulesHistory } from '../../node_box/script_revision/ui/conversation/history.js'
import { history as story } from '../../node_box/story_segments/ui/conversation/history.js'

const presentations = { project, script_revision: { ...script, ownsInput: true }, script_rules: rulesHistory,
  story_segments: { ...story, ownsInput: true }, story_rules: rulesHistory }
const presentation = type => Object.hasOwn(presentations, type) ? presentations[type] : null

/** 历史只读业务适配；只从当次记录恢复输入，不读取现在的项目Model。 */
export const taskHistoryPresentation = {
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
    const finished = steps.filter(step => ['done', 'rejected'].includes(step.step_status))
    return presentation(task.node_type)?.taskOutput(task, finished) ?? { result: null }
  },
  inputDependencies(task, steps) {
    const metadata = task.metadata || {}
    const actual = steps.find(step => step.prompt?.input != null)?.prompt.input
    const adapter = presentation(task.node_type)
    if (adapter?.ownsInput) return adapter.inputDependencies(task, actual)
    if (metadata.input_dependencies != null) return metadata.input_dependencies
    return adapter ? adapter.inputDependencies(task, actual) : actual ?? null
  },
}
