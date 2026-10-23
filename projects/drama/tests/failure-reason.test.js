import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { NodeStateModel } from '@agent-modules/task/models'
import { boxReport } from '../src/node_runtime/box_report.js'
import { projectExecutions, applyExecutionStates } from '../src/node_runtime/execution_state.js'
import { displayContext } from '../src/session/task_display_context.js'
import { createFailureDecision } from '../src/client/ui/failure-decision.js'

for (const [status, label] of [['content_issue', '内容问题'], ['upstream_issue', '上游资料问题'], ['rule_conflict', '规则冲突']]) test(`历史轮次停止码不覆盖最后一轮${status}，卡片只显示该轮问题`, () => {
  const oldReason = '已达到最大修订轮次（3轮），仍未通过审核。\n旧问题'
  const issue = { location: 'segment_003.body', reason: '最后一轮真实问题', suggestion: '完整修复状态衔接' }
  const task = { id: 't', node_type: 'script_revision', task_status: 'rejected', action: 'revise', queue_order: 1,
    metadata: { project_id: 'p', session_id: 's' }, end_reason: oldReason, started_at: '2026-10-24T00:00:00Z', ended_at: '2026-10-24T00:01:00Z' }
  const detail = { status: 'rejected', reason: oldReason, group: { id: 'g', source: 'ui' }, tasks: [task], steps: [
    { id: 'old', task_id: 't', seq: 1, kind: 'review', round: 2, step_status: 'done', result: { review: { status: 'content_issue', issues: [{ ...issue, reason: '旧问题' }] } } },
    { id: 'final', task_id: 't', seq: 2, name: '最后审核', kind: 'review', round: 3, step_status: 'done', result: { stop_code: 'revision_limit_reached', review: { status, issues: [issue] } } },
  ] }
  const report = boxReport(detail), context = displayContext(detail, task)
  assert.equal(report.decision, status); assert.equal(context.decision, status)
  assert.equal(report.reason, 'segment_003.body：最后一轮真实问题；完整修复状态衔接')
  assert.equal(context.stop_reason, report.reason)
  const records = { scope: 'drama', tasks: { history: () => ({ tasks: [task], total: 1 }), detail: () => detail } }
  const executions = projectExecutions(records, 'p')
  assert.equal(executions[0].execution.stop_code, status)
  assert.equal(executions[0].execution.message, report.reason)
  const state = new NodeStateModel({ type: 1, status: 'rejected', reason: oldReason, rules: Object.fromEntries(['generate', 'review', 'revise'].map(action => [action, { base: '', supplement: '' }])),
    last_execution: { ...executions[0].execution, stop_code: 'revision_limit_reached', message: oldReason } }).toJSON()
  const project = { basic_info: { script_revision_node: state } }
  applyExecutionStates(project, executions)
  assert.equal(state.last_execution.stop_code, status); assert.equal(state.reason, report.reason)
  assert.equal(detail.reason, oldReason); assert.equal(detail.steps[1].result.stop_code, 'revision_limit_reached')
  const dom = new JSDOM(), card = createFailureDecision(dom.window.document, {
    group: { name: '故事大纲', status: 'rejected', context }, onDetails: async () => {},
  }).shadowRoot
  assert.match(card.textContent, new RegExp(`原因类型：${label}`))
  assert.doesNotMatch(card.querySelector('.reason').textContent, /轮次|旧问题/)
  dom.window.close()
})
