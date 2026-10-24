import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { ProjectService } from '../src/node_box/project/service.js'
import { ScriptRevisionService } from '../src/node_box/script_revision/service.js'
import { createRecordService } from '../src/records/service.js'
import { CreateProjectTool } from '../src/tools/creat_project_tool.js'
import { OptimizeScriptTool } from '../src/tools/optimize_script_tool.js'
import { PlanningContextTool, ChangeRulesTool, UpdateProjectTool } from '../src/tools/planning_tools.js'
import { ReportDispatcher, createMainAgentDelivery } from '../src/session/report_dispatcher.js'
import { createPanelTaskDisplay } from '../src/session/panel_task_messages.js'
import { boxReport, waitBoxTask } from '../src/node_runtime/box_report.js'
import { planningContext } from '../src/session/planning_context.js'

const candidate = { actual_script: '候选正文', summary: '候选摘要', estimated_duration_seconds: 180 }
const issue = status => ({ status, issues: [{ location: 'basic_info.original_script', reason: '存在需要修复的依据', suggestion: '按用户要求修复，保留原始目标' }] })

async function fixture(t, kind = 'rule') {
  const root = await mkdtemp(join(tmpdir(), 'drama-main-planning-')), calls = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks)), system = body.messages.find(message => message.role === 'system').content
    const action = system.match(/动作：(\w+)/)[1], input = JSON.parse(body.messages.find(message => message.role === 'user').content.split('# 本次资料\n')[1])
    calls.push({ action, body })
    const passed = kind === 'pass' || (kind === 'rule' ? system.includes('冲突修复已授权') : input.current_script.actual_script === '修复后的原始剧本')
    const output = action === 'review' ? passed ? { status: 'passed', issues: [] } : issue(kind === 'rule' ? 'rule_conflict' : kind === 'content' ? 'content_issue' : 'upstream_issue') : {...candidate,...(input.current_script.actual_script==='修复后的原始剧本'?{actual_script:'修复后的原始剧本'}:{})}
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const projects = new ProjectService({ root, workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} }, sessionController: { create: async ({ sessionId }) => ({ sessionId }) } })
  const records = createRecordService(root), models = { read: async () => ({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, text: { model: 'writer' }, output_language: 'zh-CN' }) }
  projects.records = records
  const scripts = new ScriptRevisionService({ projects, records, models })
  t.after(async () => { await records.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const create = new CreateProjectTool({ projects })
  const created = JSON.parse(await create.execute({ name: '主Agent规划', original_script: '用户原稿' }, { callId: 'create', agent: { session: { id: 'source', snapshotEvents: () => [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '创建项目并按我的要求优化' }] } }] } } }))
  const exec = { callId: 'optimize', agent: { session: { id: created.session_id } } }
  const optimize = new OptimizeScriptTool({ scriptRevision: scripts })
  const report = JSON.parse(await optimize.execute({ instruction: '保留原始目标' }, exec))
  return { root, projects, records, scripts, calls, created, exec, optimize, report }
}

test('创建记录程序任务并交接真实目标；规则冲突报告→原生授权→保存规则→关联新任务', async t => {
  const f = await fixture(t), { report, exec } = f
  assert.equal(f.created.report.goal, '创建项目并按我的要求优化')
  assert.equal(report.decision, 'rule_conflict'); assert.equal(report.saved, true)
  assert.equal(report.review_packet.current_script.actual_script, '用户原稿')
  assert.equal(f.calls.length, 2)
  const reader = new PlanningContextTool({ projects: f.projects, records: f.records })
  const context = JSON.parse(await reader.execute({ report_id: report.report_id }, exec))
  assert.deepEqual(context.executable_boxes, ['project', 'script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'costume_image'])
  const originalRule = context.script_revision.rules.rules.review.base
  const changer = new ChangeRulesTool({ projects: f.projects, records: f.records, scriptRevision: f.scripts })
  const approvals = []
  exec.agent.ctx = { approval: { request: async request => { approvals.push(request); return 'allowed-once' } } }
  exec.callId = 'change-rule'
  const changed = JSON.parse(await changer.execute({ report_id: report.report_id, action: 'review', field: 'base', previous_value: originalRule, value: originalRule + '\n冲突修复已授权' }, exec))
  assert.equal(changed.status, 'completed'); assert.equal(changed.parent_group_id, report.group_id)
  assert.match(approvals[0].reason, /原规则：[\s\S]*新规则：/)
  const file = join(f.root, 'projects', report.project_id, 'project.json'), saved = JSON.parse(await readFile(file))
  assert.match(saved.basic_info.script_revision_node.rules.review.base, /冲突修复已授权/)
  assert.equal(saved.basic_info.script_revision_node.status, 'expired')
  exec.callId = 'retry'
  const completed = JSON.parse(await f.optimize.execute({ instruction: '按原目标继续', retry_of: report.group_id }, exec))
  assert.equal(completed.status, 'completed'); assert.notEqual(completed.group_id, report.group_id)
  assert.equal(completed.parent_group_id, report.group_id); assert.equal(completed.goal, '保留原始目标')
  assert.equal(f.records.tasks.detail('drama', report.group_id).status, 'rejected')
  assert.equal(f.records.tasks.detail('drama', report.group_id).tasks[0].metadata.input_snapshot.rules.rules.review.base, originalRule)
  assert.equal(f.calls.length, 4)
})

test('拒绝授权、无授权服务调用及跨会话不能改规则；未修复不能盲目重试', async t => {
  const f = await fixture(t), before = (await f.projects.snapshot(f.exec.agent.session.id)).project
  const patch = { action: 'review', field: 'base', previous_value: before.basic_info.script_revision_node.rules.review.base, value: '新规则' }
  const tool = new ChangeRulesTool({ projects: f.projects, records: f.records, scriptRevision: f.scripts })
  f.exec.agent.ctx = { approval: { request: async () => 'rejected' } }
  const rejected = JSON.parse(await tool.execute({ report_id: f.report.report_id, ...patch }, f.exec))
  assert.equal(rejected.saved, false)
  assert.deepEqual((await f.projects.snapshot(f.exec.agent.session.id)).project, before)
  await assert.rejects(f.scripts.changeRules(patch, { sessionId: f.exec.agent.session.id, requestId: 'bad', reportId: f.report.report_id }), /授权/)
  await assert.rejects(tool.execute({ report_id: f.report.report_id, ...patch }, { agent: { session: { id: 'source' } } }), /没有项目|当前项目会话/)
  await assert.rejects(f.optimize.execute({ instruction: '重试', retry_of: f.report.group_id }, { ...f.exec, callId: 'unchanged' }), /尚未变化/)
})

test('上游报告→修改项目资料任务→过期事实→重派原目标，旧报告不变', async t => {
  const f = await fixture(t, 'upstream'), tool = new UpdateProjectTool({ projects: f.projects })
  assert.equal(f.report.decision, 'upstream_issue'); assert.deepEqual(f.report.related_nodes, ['project'])
  const modified = JSON.parse(await tool.execute({ report_id: f.report.report_id, command: { kind: 'import_script',value: '修复后的原始剧本',previousValue:(await f.projects.snapshot(f.exec.agent.session.id)).project.basic_info.original_script_file_path } }, { ...f.exec, callId: 'upstream' }))
  assert.equal(modified.status, 'completed'); assert.equal(modified.parent_group_id, f.report.group_id)
  const context = await planningContext(f.projects, f.records, { sessionId: f.exec.agent.session.id, reportId: f.report.group_id })
  assert.equal(context.dependencies.find(row => row.node_type === 'script_revision').state, 'empty')
  const retry = JSON.parse(await f.optimize.execute({ instruction: '继续原目标', retry_of: f.report.group_id }, { ...f.exec, callId: 'retry-upstream' }))
  assert.equal(retry.status, 'completed'); assert.equal(retry.goal, '保留原始目标')
  assert.equal(Object.hasOwn(f.report.review_packet,'reference_episode_duration_seconds'),false)
  assert.notEqual(f.report.review_packet.current_script.actual_script,'修复后的原始剧本')
  assert.equal((await f.projects.snapshot(f.exec.agent.session.id)).project.basic_info.actual_script, '修复后的原始剧本')
})

test('授权期间规则被修改时拒绝旧值覆盖，失败保留新规则', async t => {
  const f = await fixture(t), id = f.exec.agent.session.id, old = (await f.projects.snapshot(id)).project.basic_info.script_revision_node.rules.review.base
  const tool = new ChangeRulesTool({ projects: f.projects, records: f.records, scriptRevision: f.scripts })
  f.exec.agent.ctx = { approval: { request: async () => {
    await f.projects.edit({ kind: 'rules', node_type: 'script_revision', action: 'review', field: 'supplement', value: '用户新意见', previousValue: '' }, { sessionId: id, projectId: f.report.project_id })
    return 'allowed-once'
  } } }
  // 同字段CAS测试：先用已有项目写入口更新补充规则，再提交旧补充值。
  const report = JSON.parse(await tool.execute({ report_id: f.report.report_id, action: 'review', field: 'supplement', previous_value: '', value: 'AI建议' }, { ...f.exec, callId: 'conflict' }))
  assert.equal(report.status, 'failed'); assert.match(report.reason, /规则已变化/)
  const rules = (await f.projects.snapshot(id)).project.basic_info.script_revision_node.rules.review
  assert.equal(rules.supplement, '用户新意见'); assert.equal(rules.base, old)
})

test('面板与新项目报告持久投递，重开不重复，会话Tool报告不另发通知', async t => {
  const f = await fixture(t, 'pass'), delivered = []
  let dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => delivered.push(report) })
  await dispatcher.flush(); assert.equal(delivered.length, 1); assert.equal(delivered[0].session_id, f.created.session_id)
  const accepted = await f.scripts.optimizeScript({ instruction: '面板任务' }, { sessionId: f.created.session_id, requestId: 'ui', source: 'ui' })
  await f.scripts.waitScriptOptimization(accepted.group_id, f.created.session_id)
  await dispatcher.flush(); await dispatcher.dispose()
  assert.equal(delivered.length, 1)
  dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => delivered.push(report) })
  await dispatcher.flush(); await dispatcher.dispose(); assert.equal(delivered.length, 1)
  const ledger = JSON.parse(await readFile(join(f.root, 'main-agent-deliveries.json')))
  assert.ok(ledger[accepted.group_id].delivered)
})

test('投递失败重开重试；Harness消息标记业务来源，宿主已收取但账本未写也不重复', async t => {
  const f = await fixture(t, 'pass'), messages = []
  let dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async () => { throw new Error('宿主暂不可用') } })
  await dispatcher.flush(); await dispatcher.dispose()
  assert.equal(JSON.parse(await readFile(join(f.root, 'main-agent-deliveries.json')))[f.created.group_id].delivered, false)
  const agent = { session: { snapshotEvents: () => [] }, inbox: { nextTurn: messages, nextStep: [] }, followup: message => messages.push(message) }
  f.projects.applyMainAgent = async () => {}
  const deliver = createMainAgentDelivery({ agents: { get: () => agent } }, f.projects)
  dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver })
  await dispatcher.flush(); await dispatcher.dispose()
  assert.equal(messages.length, 1); assert.equal(messages[0].source.kind, 'drama-box-report'); assert.notEqual(messages[0].source.kind, 'user')
  await deliver(f.created.report); assert.equal(messages.length, 1)
})

for (const kind of ['upstream', 'rule']) test(`面板${kind}问题向项目已有空会话追加消息，关联消息ID，不创建会话`, async t => {
  const f = await fixture(t, kind), messages = [], events = [], selected = []
  f.projects.sessionController.create = async () => { assert.fail('任务交接不得创建会话') }
  f.projects.applyMainAgent = async sessionId => selected.push(sessionId)
  const agent = { session: { snapshotEvents: () => events }, inbox: { nextTurn: messages, nextStep: [] }, followup: message => messages.push(message) }
  const deliver = createMainAgentDelivery({ agents: { get: id => id === f.created.session_id ? agent : null } }, f.projects)
  const panel = await f.scripts.optimizeScript({ instruction: '按面板要求优化' }, { sessionId: f.created.session_id, requestId: 'panel-problem', source: 'ui' })
  const report = await f.scripts.waitScriptOptimization(panel.group_id, f.created.session_id)
  assert.equal(report.decision, kind === 'upstream' ? 'upstream_issue' : 'rule_conflict')
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver })
  await dispatcher.flush(); await dispatcher.dispose()
  const message = messages.find(message => message.content[0].text.includes(panel.group_id))
  assert.ok(message); assert.equal(message.source.kind, 'drama-box-report')
  assert.match(message.content[0].text, /按面板要求优化/)
  assert.ok(selected.every(id => id === f.created.session_id))
  const ledger = JSON.parse(await readFile(join(f.root, 'main-agent-deliveries.json')))
  assert.equal(ledger[panel.group_id].message_id, message.id)
  assert.equal(ledger[panel.group_id].session_id, f.created.session_id)
  assert.equal(ledger[panel.group_id].task_id, report.task_id)
  assert.equal(ledger[panel.group_id].report_id, panel.group_id)
  // 消息已进入宿主持久历史，收件箱已清空时同样去重。
  events.push({ type: 'user/message', data: message }); messages.splice(messages.indexOf(message), 1)
  const receipt = await deliver(report)
  assert.equal(receipt.message_id, message.id)
  assert.ok(!messages.some(item => item.id === message.id))
  const restarted = new ReportDispatcher({ root: f.root, records: f.records, deliver })
  await restarted.flush(); await restarted.dispose()
  assert.ok(!messages.some(item => item.id === message.id))
})

test('缺少会话、错误归属、删除项目和Agent不可用均不兜底创建会话', async t => {
  const f = await fixture(t), messages = []
  f.projects.sessionController.create = async () => { assert.fail('失败不得创建替代会话') }
  f.projects.applyMainAgent = async () => {}
  const agent = { session: { snapshotEvents: () => [] }, followup: message => messages.push(message) }
  const deliver = createMainAgentDelivery({ agents: { get: () => agent } }, f.projects)
  await assert.rejects(deliver({ ...f.report, session_id: null }), /缺少项目关联会话/)
  await assert.rejects(deliver({ ...f.report, session_id: 'source' }), /项目已删除或会话归属改变/)
  const unavailable = createMainAgentDelivery({ agents: { get: () => null } }, f.projects)
  await assert.rejects(unavailable(f.report), /主Agent当前不可用/)
  f.projects.workspaceController.delete = async () => {}
  await f.projects.remove({ sessionId: f.created.session_id, projectId: f.report.project_id })
  await assert.rejects(deliver(f.report), /项目已删除或会话归属改变/)
  assert.deepEqual(messages, [])
})


for (const kind of ['pass', 'upstream', 'rule']) test(`面板${kind}：开始和结果独立展示，仅失败唤醒模型`, async t => {
  const f = await fixture(t, kind), events = [], followups = [], order = []
  f.projects.sessionController.create = async () => { assert.fail('面板展示不创建会话') }
  const agent = { session: {
    snapshotEvents: () => events,
    append: async (type, data) => { events.push({ type, data }); order.push(type) },
  }, inbox: { nextTurn: followups, nextStep: [] }, followup: message => { followups.push(message); order.push('followup') } }
  const ctx = { sessionController: { resolveAgent: async id => { assert.equal(id, f.created.session_id); return { agent } } }, agents: { get: () => agent } }
  f.projects.applyMainAgent = async () => {}
  const display = createPanelTaskDisplay(ctx, f.projects)
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: createMainAgentDelivery(ctx, f.projects), display })
  await dispatcher.flush() // 会话创建项目后的目标交接不属于本次面板操作。
  followups.length = 0; order.length = 0
  f.projects.showPanelTaskStart = async id => {
    assert.equal(f.calls.length, 2, '开始展示必须先于本次盒子调用')
    const detail = f.records.tasks.detail(f.records.scope, id)
    await display(boxReport(detail), 'start', detail.tasks[0].name)
  }
  const accepted = await f.scripts.optimizeScript({ instruction: '本次面板要求' }, { sessionId: f.created.session_id, requestId: 'display', source: 'ui' })
  await f.scripts.waitScriptOptimization(accepted.group_id, f.created.session_id)
  await dispatcher.flush(); await dispatcher.dispose()
  const starts = events.filter(event => event.type === 'command/run')
  const results = events.filter(event => event.type === 'command/done')
  assert.equal(starts.length, 4); assert.equal(results.length, 4)
  const cards = starts.map(event => JSON.parse(event.data.args))
  assert.deepEqual(cards.map(card => card.phase), ['start', 'step', 'step', 'result'])
  assert.equal(cards[2].status, kind === 'pass' ? 'done' : 'rejected')
  assert.notEqual(starts[0].data.commandId, starts[1].data.commandId)
  assert.match(results[0].data.text, /已受理/); assert.match(results.at(-1).data.text, /本次面板要求/)
  assert.ok(!events.some(event => event.type === 'user/message' || event.type === 'assistant/message'))
  assert.equal(followups.length, kind === 'pass' ? 0 : 1)
  assert.equal(f.calls.length, 4, '展示不增加盒子模型请求')
  if (kind !== 'pass') assert.equal(order.at(-1), 'followup', '先展示失败结果再交给主Agent')
})

test('用户取消的面板任务只展示取消结果，不唤醒主Agent', async t => {
  const f = await fixture(t, 'pass'), displayed = [], delivered = []
  const id = 'panel-cancelled'
  f.records.tasks.submit(f.records.scope, { group: { id, name: '取消测试', source: 'ui', metadata: { notify_main: true } },
    tasks: [{ node_type: 'script_revision', action: 'generate', name: '剧本优化', metadata: { session_id: f.created.session_id, project_id: f.created.project_id } }] })
  f.records.tasks.cancel(f.records.scope, id, '用户取消')
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => delivered.push(report), display: async report => displayed.push(report) })
  await dispatcher.flush(); await dispatcher.dispose()
  assert.equal(displayed[0].status, 'cancelled')
  assert.ok(!delivered.some(report => report.group_id === id))
})


test('面板执行异常先展示失败结果，再发送规划报告', async t => {
  const f = await fixture(t, 'pass'), order = []
  f.records.tasks.register('broken_panel', { label: '异常测试', plan: () => [{ kind: 'run', name: '程序操作', executor: 'program' }], execute: async () => { throw new Error('执行器异常依据') } })
  const id = 'panel-failed'
  f.records.tasks.submit(f.records.scope, { group: { id, name: '异常测试', source: 'ui', metadata: { notify_main: true } },
    tasks: [{ node_type: 'broken_panel', action: 'run', name: '异常测试', metadata: { session_id: f.created.session_id, project_id: f.created.project_id, goal: '原目标' } }] })
  f.records.tasks.start(f.records.scope)
  const report = await waitBoxTask(f.records, id)
  assert.equal(report.status, 'failed')
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => { if (report.group_id === id) order.push('model') },
    display: async report => { assert.match(report.reason, /执行器异常依据/); order.push('display') } })
  await dispatcher.flush(); await dispatcher.dispose()
  assert.deepEqual(order, ['display', 'model'])
})

test('步骤结束即展示，盒子仍运行时不通知；自动修订每轮独立，重开不会补写已展示步骤', async t => {
  const f = await fixture(t, 'pass'), shown = [], notifications = []
  let release, waiting
  const reached = new Promise(resolve => { waiting = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => notifications.push(report), display: async (report, phase, name, step) => shown.push({ report, phase, step }) })
  await dispatcher.flush(); notifications.length = 0
  f.records.tasks.register('step_demo', { label: '步骤测试', plan: () => [
    { kind: 'review', name: '审核', round: 1, executor: 'ai' },
    { kind: 'revise', name: '修改', round: 1, executor: 'ai' },
    { kind: 'review', name: '复审', round: 2, executor: 'ai' },
  ], execute: async ctx => {
    if (ctx.step.kind === 'revise') { waiting(); await gate }
    return { result: ctx.step.kind === 'review' ? { review: { status: ctx.step.round === 1 ? 'content_issue' : 'passed', issues: [] } } : { output: '修订正文' } }
  } })
  const id = 'live-step-demo'
  f.records.tasks.submit(f.records.scope, { group: { id, source: 'ui', metadata: { notify_main: true } }, tasks: [{ node_type: 'step_demo', name: '步骤测试', action: 'generate', metadata: { session_id: f.created.session_id, project_id: f.created.project_id } }] })
  f.records.tasks.start(f.records.scope)
  await reached; await dispatcher.flush()
  assert.equal(f.records.tasks.detail(f.records.scope, id).status, 'running')
  assert.equal(shown.filter(item => item.phase === 'step').length, 1)
  assert.equal(notifications.length, 0)
  release(); await waitBoxTask(f.records, id); await dispatcher.flush()
  assert.deepEqual(shown.filter(item => item.phase === 'step').map(item => [item.step.kind, item.step.round]), [['review', 1], ['revise', 1], ['review', 2]])
  assert.match(shown.find(item => item.phase === 'result').report.stopped_at, /复审/)
  assert.equal(notifications.length, 0)
  await dispatcher.dispose()
  const count = shown.length
  const restarted = new ReportDispatcher({ root: f.root, records: f.records, deliver: async () => assert.fail('成功不通知'), display: async () => shown.push('duplicate') })
  await restarted.flush(); await restarted.dispose()
  assert.equal(shown.length, count)
})

test('展示与通知独立投递和重试：展示失败仍通知，通知失败不重复已展示结果', async t => {
  const f = await fixture(t, 'pass'), delivered = [], displayed = [], errors = []
  const id = 'independent-failure'
  let failDisplay = true, failDelivery = false
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records,
    display: async (report, phase) => { if (report.group_id === id && failDisplay) throw new Error('展示暂不可用'); displayed.push(phase) },
    deliver: async report => { if (report.group_id === id) { if (failDelivery) throw new Error('通知暂不可用'); delivered.push(report.group_id) } }, onError: error => errors.push(error.message) })
  await dispatcher.flush()
  f.records.tasks.register('independent', { label: '异常', plan: () => [{ kind: 'run', name: '失败步骤', executor: 'program' }], execute: async () => { throw new Error('执行异常') } })
  f.records.tasks.submit(f.records.scope, { group: { id, source: 'ui', metadata: { notify_main: true } }, tasks: [{ node_type: 'independent', action: 'run', name: '异常', metadata: { session_id: f.created.session_id, project_id: f.created.project_id } }] })
  f.records.tasks.start(f.records.scope); await waitBoxTask(f.records, id); await dispatcher.flush()
  assert.deepEqual(delivered, [id]); assert.ok(errors.includes('展示暂不可用'))
  failDisplay = false; await dispatcher.flush()
  assert.deepEqual(delivered, [id]); assert.deepEqual(displayed, ['start', 'step', 'result'])
  await dispatcher.dispose()
  // 模拟通知尚未持久投递、展示已完成的恢复状态。
  const path = join(f.root, 'main-agent-deliveries.json'), ledger = JSON.parse(await readFile(path))
  ledger[id].delivered = false; ledger[id].notification = { delivered: false }
  await (await import('node:fs/promises')).writeFile(path, JSON.stringify(ledger))
  failDelivery = true
  const resumed = new ReportDispatcher({ root: f.root, records: f.records,
    display: async () => assert.fail('已展示结果不重复'), deliver: async report => { if (report.group_id === id) { if (failDelivery) throw new Error('通知暂不可用'); delivered.push(id) } } })
  await resumed.flush(); failDelivery = false; await resumed.flush(); await resumed.dispose()
  assert.deepEqual(delivered, [id, id])
})

test('创建尚未建立新会话就失败时，来源会话主Agent能收到原目标和停止原因', async t => {
  const f = await fixture(t, 'pass'), messages = []
  const agent = { session: { snapshotEvents: () => [] }, followup: message => messages.push(message) }
  f.projects.applyMainAgent = async id => assert.equal(id, 'source')
  const deliver = createMainAgentDelivery({ agents: { get: id => id === 'source' ? agent : null } }, f.projects)
  await deliver({ ...f.report, node_type: 'project', action: 'create', session_id: 'source', source_session_id: 'source', project_id: 'new-not-created', status: 'failed', reason: '工作区名称重复' })
  assert.equal(messages.length, 1); assert.match(messages[0].content[0].text, /工作区名称重复/)
})

test('会话展示读取当次盒子/步骤输入，历史项目改变不污染；轮询不携带完整正文、规则或输出', async t => {
  const f = await fixture(t, 'pass'), events = []
  const agent = { session: { snapshotEvents: () => events, append: async (type, data) => events.push({ type, data }) } }
  const display = createPanelTaskDisplay({ sessionController: { resolveAgent: async () => ({ agent }) } }, f.projects)
  await f.projects.edit({ kind: 'import_script', value: '本次优化前工作稿', previousValue: (await f.projects.snapshot(f.created.session_id)).project.basic_info.original_script_file_path }, { sessionId: f.created.session_id, projectId: f.created.project_id })
  const accepted = await f.scripts.optimizeScript({ instruction: '完善基地细节' }, { sessionId: f.created.session_id, source: 'ui', requestId: 'snapshot-display' })
  await f.scripts.waitScriptOptimization(accepted.group_id, f.created.session_id)
  const detail = f.records.tasks.detail(f.records.scope, accepted.group_id), report = boxReport(detail)
  await display(report, 'start', '剧本优化')
  for (const step of detail.steps) await display(report, 'step', '剧本优化', step)
  await display(report, 'result', '剧本优化')
  const rows = await display.read(f.created.session_id)
  const start = rows.find(row => row.phase === 'start'), review = rows.find(row => row.step_name === '剧本本地审核'), result = rows.find(row => row.phase === 'result')
  assert.equal(start.box_input.instruction, '完善基地细节')
  assert.equal(start.project_name, '主Agent规划')
  assert.equal(start.box_input.current_script.actual_script, '本次优化前工作稿')
  assert.equal(review.input.current_script.actual_script, '候选正文')
  assert.equal(result.final_output.actual_script, '候选正文'); assert.equal(result.saved, true)
  assert.ok(start.rules.rules.review.base)
  assert.equal(start.box_input.rules, undefined, '规则在独立详情展示，不在盒子参数重复')
  const compact = await display.read(f.created.session_id, { compact: true })
  for (const row of compact) for (const key of ['box_input', 'input', 'rules', 'result', 'final_output', 'summary']) assert.equal(Object.hasOwn(row, key), false)
  assert.doesNotMatch(JSON.stringify(compact), /actual_script|候选正文/)
  assert.equal((await display.read(f.created.session_id, { id: review.id })).length, 1)
  assert.deepEqual(await display.read(f.created.session_id, { id: 'foreign-message' }), [])
  await f.projects.edit({ kind: 'import_script', value: '后来用户导入的新正文', previousValue: (await f.projects.snapshot(f.created.session_id)).project.basic_info.original_script_file_path }, { sessionId: f.created.session_id, projectId: f.created.project_id })
  const old = (await display.read(f.created.session_id, { id: start.id }))[0]
  assert.equal(old.box_input.current_script.actual_script, '本次优化前工作稿')
})

test('终态内容审核失败只展示用户决策，不唤醒主Agent或发起新任务', async t => {
  const f = await fixture(t, 'content'), notifications = [], displays = []
  assert.equal(f.report.requires_user_decision, true)
  const accepted = await f.scripts.optimizeScript({ instruction: '面板生成剧本' }, { sessionId: f.created.session_id, requestId: 'panel-content', source: 'ui' })
  const report = await f.scripts.waitScriptOptimization(accepted.group_id, f.created.session_id)
  const count = f.calls.length
  const dispatcher = new ReportDispatcher({ root: f.root, records: f.records, deliver: async report => notifications.push(report), display: async (report, phase) => { displays.push({ report, phase }); return {} } })
  await dispatcher.flush(); await dispatcher.flush(); await dispatcher.dispose()
  assert.ok(displays.some(row => row.phase === 'result' && row.report.group_id === report.group_id && row.report.requires_user_decision))
  assert.ok(!notifications.some(row => row.group_id === report.group_id))
  assert.equal(f.calls.length, count)
  const ledger = JSON.parse(await readFile(join(f.root, 'main-agent-deliveries.json')))
  assert.equal(ledger[report.group_id].delivered, true)
})
