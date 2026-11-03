import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { NodeStateModel, TASK_END_REASONS, taskEndReason } from '@agent-modules/task/models'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createRecordService } from '../src/records/service.js'
import { ReportDispatcher } from '../src/main_agent/session/report_dispatcher.js'
import { boxReport } from '../src/main_agent/session/box_report.js'
import { displayContext } from '../src/main_agent/session/task_display_context.js'
import { createFailureDecision } from '../src/client/ui/failure-decision.js'

test('网络失败卡片不等待选择且只保留可用的任务详情，其他失败仍可操作', async () => {
  const dom = new JSDOM()
  for (const requires_user_decision of [false, true]) {
    let opened = 0
    const card = createFailureDecision(dom.window.document, {
      group: { name: '盒子', status: 'failed', context: { reason_type: 'network_connection_failed', reason_label: '网络连接失败', requires_user_decision, saved: true, stop_reason: '网络连接失败（ECONNREFUSED）' } },
      decision: requires_user_decision ? '已停止后续处理' : undefined,
      onDecision: () => assert.fail('网络失败不需要停止操作'), onDetails: async () => { opened++ },
    }).shadowRoot
    assert.equal(card.querySelector('.badge').textContent, '流程已停止')
    assert.match(card.querySelector('h3').textContent, /流程已停止/)
    assert.doesNotMatch(card.textContent, /等待你的选择|需要你处理|继续修改|重新生成/)
    assert.match(card.querySelector('.reason').textContent, /ECONNREFUSED/)
    assert.deepEqual([...card.querySelectorAll('button')].map(button => button.textContent), ['任务详情'])
    await card.querySelector('button').onclick(); assert.equal(opened, 1)
  }
  const other = createFailureDecision(dom.window.document, {
    group: { name: '盒子', status: 'failed', context: { reason_type: 'execution_error', requires_user_decision: true } }, onDecision: async () => {},
  }).shadowRoot
  assert.equal(other.querySelector('.badge').textContent, '等待你的选择')
  assert.deepEqual([...other.querySelectorAll('button')].map(button => button.textContent), ['停止', '重新生成', '任务详情'])
  dom.window.close()
})

test('原因枚举统一验证终态，拒绝不存在或与状态不匹配的原因', () => {
  assert.equal(Object.keys(TASK_END_REASONS).length, 10)
  for (const [stop_code, { statuses }] of Object.entries(TASK_END_REASONS)) for (const status of statuses) {
    const last_execution = { task_id: 't', status, stop_code, message: '终态原因', finished_at: '2026-10-25T00:00:00Z' }
    assert.equal(new NodeStateModel({ last_execution }).last_execution.stop_code, stop_code)
    assert.throws(() => new NodeStateModel({ last_execution: { ...last_execution, stop_code: 'unknown' } }), /stop_code/)
  }
})

for (const [error_code, http, expected] of [
  ['NETWORK_CONNECTION_FAILED', [], 'network_connection_failed'],
  ['INVALID_NODE_OUTPUT', [], 'validation_failed'],
  [null, [{ ok: false }], 'request_failed'],
  [null, [], 'execution_error'],
]) test(`失败原因${expected}从步骤事实投影到报告、节点与卡片`, () => {
  const task = { id: 't', node_type: 'project', task_status: 'failed', metadata: { project_id: 'p', session_id: 's' }, end_reason: '详细原因', ended_at: '2026-10-25T00:00:00Z' }
  const detail = { status: 'failed', reason: task.end_reason, group: { id: 'g', source: 'ui' }, tasks: [task], steps: [{ task_id: 't', step_status: 'failed', result: { error_code }, http }] }
  const report = boxReport(detail), context = displayContext(detail, task)
  assert.equal(taskEndReason(task, detail.steps), expected)
  assert.equal(report.reason_type, expected); assert.equal(context.reason_type, expected)
  const records = { scope: 'drama', tasks: { history: () => ({ tasks: [task], total: 1 }), detail: () => detail } }
  const dom = new JSDOM(), card = createFailureDecision(dom.window.document, { group: { name: '创建项目', status: 'failed', context: { ...context, saved: true } } }).shadowRoot
  assert.match(card.textContent, new RegExp(`原因类型：${TASK_END_REASONS[expected].label}`))
  assert.doesNotMatch(card.textContent, /审核未通过/)
  dom.window.close()
})

test('创建项目网络失败只展示，不唤醒主Agent；历史错误一次性迁移且重启不补发', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-network-reason-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let records = createRecordService(root)
  records.tasks.register('project', { plan: () => [{ kind: 'extract_summary' }], execute: async () => { throw new Error('网络连接失败（ECONNREFUSED），已在1秒后重试一次') } })
  const { group } = records.tasks.submit('drama', { group: { source: 'ui', metadata: { notify_main: true } }, tasks: [{ node_type: 'project', action: 'create', metadata: { project_id: 'p', session_id: 's' } }] })
  records.tasks.start('drama'); await records.tasks.idle('drama'); await records.dispose()
  // 模拟升级前数据库：无结构化错误码、无本次迁移记录。
  const database = new DatabaseSync(join(root, 'records.sqlite'))
  database.exec("DELETE FROM drama_record_migrations WHERE name='network-error-code-v1'; UPDATE agent_task_steps SET data=json_set(data,'$.result',NULL)")
  database.close()
  records = createRecordService(root)
  const migrated = records.tasks.detail('drama', group.id)
  assert.equal(migrated.steps[0].result.error_code, 'NETWORK_CONNECTION_FAILED')
  assert.equal(boxReport(migrated).reason_type, 'network_connection_failed')
  const shown = [], sent = []
  let dispatcher = new ReportDispatcher({ root, records, display: async (report, phase) => { shown.push({ report, phase }); return {} }, deliver: async report => sent.push(report) })
  await dispatcher.flush(); await dispatcher.dispose(); await records.dispose()
  assert.equal(sent.length, 0)
  assert.ok(shown.some(row => row.phase === 'result' && row.report.reason_type === 'network_connection_failed'))
  records = createRecordService(root)
  dispatcher = new ReportDispatcher({ root, records, display: async () => assert.fail('重启不重复展示'), deliver: async () => assert.fail('网络失败不唤醒主Agent') })
  await dispatcher.flush(); await dispatcher.dispose()
  assert.deepEqual(records.tasks.detail('drama', group.id), migrated)
  await records.dispose()
})

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
  assert.equal(detail.reason, oldReason); assert.equal(detail.steps[1].result.stop_code, 'revision_limit_reached')
  const dom = new JSDOM(), card = createFailureDecision(dom.window.document, {
    group: { name: '故事大纲', status: 'rejected', context }, onDetails: async () => {},
  }).shadowRoot
  assert.match(card.textContent, new RegExp(`原因类型：${label}`))
  assert.doesNotMatch(card.querySelector('.reason').textContent, /轮次|旧问题/)
  dom.window.close()
})
