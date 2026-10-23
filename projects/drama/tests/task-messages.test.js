import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createPanelTaskDisplay } from '../src/session/panel_task_messages.js'
import { groupTaskMessages } from '../src/client/ui/task-operation.js'
import { mountTaskMessages } from '../src/client/task-messages.js'

const report = { group_id: 'g', report_id: 'g', task_id: 't', node_type: 'script_revision', action: 'generate', session_id: 's', source_session_id: 's', project_id: 'p', goal: '目标', status: 'completed' }
const step = { id: 'step1', task_id: 't', seq: 2, round: 1, kind: 'review', name: '本地审核', step_status: 'done', result: { review: { status: 'content_issue', issues: [{ location: '正文', reason: '内容缺失', suggestion: '补充' }] } } }
const projects = { snapshot: async id => ({ project: id === 's' ? { basic_info: { id: 'p' } } : null }) }

function displayFixture() {
  const events = [], sessions = []
  let fail = false
  const session = { snapshotEvents: () => structuredClone(events), append: async (type, data) => {
    if (type === 'command/done' && fail) { fail = false; throw new Error('写入中断') }
    events.push({ type, data })
  } }
  const ctx = { sessionController: { resolveAgent: async id => { sessions.push(id); return { agent: { session } } } } }
  return { events, sessions, ctx, setFail: () => { fail = true }, display: createPanelTaskDisplay(ctx, projects) }
}

test('步骤完整结果只写log-only；审核未通过、稳定ID、并发和重建适配器不重复', async () => {
  const f = displayFixture()
  await Promise.all([f.display(report, 'step', '剧本优化', step), f.display(report, 'step', '剧本优化', step)])
  await createPanelTaskDisplay(f.ctx, projects)(report, 'step', '剧本优化', step)
  assert.equal(f.events.length, 2)
  assert.deepEqual(f.events.map(event => event.type), ['command/run', 'command/done'])
  const [card] = await f.display.read('s')
  assert.equal(card.label, '未通过'); assert.equal(card.status, 'rejected'); assert.equal(card.round, 1)
  assert.deepEqual(card.result, step.result); assert.match(card.reason, /内容缺失/)
  assert.equal(f.events[1].data.kind, 'error')
  const next = { ...step, id: 'step2', seq: 4, round: 2, result: { review: { status: 'passed', issues: [] } } }
  await f.display(report, 'step', '剧本优化', next)
  const cards = await f.display.read('s')
  assert.equal(cards.length, 2); assert.notEqual(cards[0].id, cards[1].id)
})

test('command/run成功而done失败：读取暂不展示，重试只补done', async () => {
  const f = displayFixture(); f.setFail()
  await assert.rejects(f.display(report, 'step', '剧本优化', step), /写入中断/)
  assert.deepEqual(await f.display.read('s'), [])
  await createPanelTaskDisplay(f.ctx, projects)(report, 'step', '剧本优化', step)
  assert.equal(f.events.length, 2); assert.equal((await f.display.read('s')).length, 1)
})

test('创建失败投来源会话；创建完成后步骤及结果投项目会话；错误归属拒绝', async () => {
  const f = displayFixture(), creating = { ...report, node_type: 'project', action: 'create', project_id: 'new', session_id: 'origin', source_session_id: 'origin', status: 'failed' }
  await f.display(creating, 'result', '创建项目')
  assert.equal(f.sessions[0], 'origin')
  const created = { ...creating, project_id: 'p', session_id: 's', status: 'completed', result: { session_id: 's' } }
  await f.display(created, 'step', '创建项目', step)
  assert.equal(f.sessions.at(-1), 's')
  await assert.rejects(f.display({ ...report, session_id: 'foreign' }, 'result', '优化'), /归属改变/)
})


const messages = [
  { id: 'start', group_id: 'g', task_id: 't', phase: 'start', title: '剧本优化', goal: '完善探月基地的描述', source: 'ui', operation_name: '剧本优化', operation_status: 'completed', box_input_description: { origin: '当前工作稿', project_name: '月界旅行', characters: 100 } },
  { id: 's1', group_id: 'g', phase: 'step', seq: 1, step_name: '按意见修改', status: 'done', label: '已完成' },
  { id: 's2', group_id: 'g', phase: 'step', seq: 2, step_name: '本地审核', status: 'rejected', label: '未通过', issue_summary: '基地空间关系不明确' },
  { id: 's3', group_id: 'g', phase: 'step', seq: 3, round: 1, step_name: '自动修改', status: 'done', label: '已完成' },
  { id: 's4', group_id: 'g', phase: 'step', seq: 4, round: 1, step_name: '本地审核', status: 'done', label: '已完成' },
  { id: 'result', group_id: 'g', phase: 'result', title: '剧本优化', operation_name: '剧本优化', operation_status: 'completed', node_type: 'script_revision', status: 'completed', label: '已完成', saved: true, revision_count: 1, duration_seconds: 20, summary: '不应默认出现的长剧本摘要' },
]
const boxInput = { current_script: { actual_script: '基地旧正文', summary: '旧摘要', estimated_duration_seconds: 90 }, instruction: '完善探月基地的描述', output_language: 'zh-CN' }
function uiFixture(t, { fetcher, phase = 'hero' } = {}) {
  const dom = new JSDOM(`<div data-conversation-content data-conversation-session="s" data-content-phase="${phase}"><div data-conversation-scroll><div data-composer-seat><div class="composer-stack"><div class="hero"><span data-slot="conversation.hero.brand.mark">欢迎标题</span></div><div class="workspace">工作区</div><div data-slot="conversation.composer.bar"><textarea>未提交的草稿</textarea></div></div></div></div></div>`)
  let session = 's', copied
  const requests = []
  const request = fetcher || (async url => {
    requests.push(url)
    const id = new URL(url, 'http://test').searchParams.get('id')
    return { ok: true, json: async () => ({ messages: id ? [{ ...messages.find(message => message.id === id), box_input: boxInput, input: id === 's2' ? { ...boxInput, current_script: { actual_script: '候选正文' } } : boxInput, rules: { review: '当次审核规则' }, result: step.result, final_output: { actual_script: '基地新正文' } }] : structuredClone(messages) }) }
  })
  const ui = mountTaskMessages({ document: dom.window.document, getSessionId: () => session, fetcher: request, copy: async text => { copied = text }, onNotify: () => {}, interval: 60000 })
  t.after(() => { ui.dispose(); dom.window.close() })
  return { ui, dom, requests, setSession: id => { session = id; dom.window.document.querySelector('[data-conversation-content]').dataset.conversationSession = id }, copied: () => copied,
    operation: () => ui.element.shadowRoot.querySelector('drama-task-operation')?.shadowRoot }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('同一操作聚合请求、4步骤、最终结果：默认收起过程，要求只出现一次，不展示长摘要和JSON', async t => {
  const f = uiFixture(t); await f.ui.refresh()
  const root = f.operation()
  assert.equal(f.ui.element.shadowRoot.querySelectorAll('drama-task-operation').length, 1)
  assert.equal(root.querySelectorAll('.request').length, 1)
  assert.equal(root.querySelectorAll('.step').length, 4)
  assert.equal(root.querySelector('[data-expand="process"]').open, false)
  assert.equal(root.querySelector('.request h3').textContent, '完善探月基地的描述')
  assert.match(root.querySelector('.request').textContent, /当前工作稿 ·《月界旅行》 · 100字/)
  assert.match(root.querySelector('.outcome').textContent, /优化完成，已保存/)
  assert.doesNotMatch(root.textContent, /不应默认出现的长剧本摘要|"output"|current_script/)
  assert.match(root.querySelector('[data-expand="step:s2"]').textContent, /未通过 · 已解决/)
  assert.equal(root.querySelector('[data-expand="step:s2"] .badge').classList.contains('error'), true)
  assert.equal(f.requests.length, 1); assert.match(f.requests[0], /compact=1/)
})

test('展开才读取真实盒子及步骤输入输出，支持复制；重复轮询保留展开状态且不重复读取详情', async t => {
  const f = uiFixture(t); await f.ui.refresh()
  let root = f.operation()
  const input = root.querySelector('[data-expand="box-input"]'); input.open = true; await input.ontoggle()
  assert.match(input.textContent, /基地旧正文|当次审核规则/)
  await [...input.querySelectorAll('button')].find(button => button.textContent === '复制盒子输入').onclick()
  assert.deepEqual(JSON.parse(f.copied()), boxInput)
  const review = root.querySelector('[data-expand="step:s2"]'); review.open = true; await review.ontoggle()
  assert.match(review.textContent, /候选正文/); assert.match(review.textContent, /步骤输出/)
  await f.ui.refresh(); root = f.operation()
  assert.equal(root.querySelector('[data-expand="box-input"]').open, true)
  assert.equal(f.requests.filter(url => url.includes('&id=start')).length, 1)
})

test('隐藏空白欢迎区、输入底部停靠且保留原输入实例与未提交草稿，进入正常聊天后还原', async t => {
  const f = uiFixture(t), doc = f.dom.window.document, textarea = doc.querySelector('textarea')
  await f.ui.refresh()
  assert.equal(doc.querySelector('[data-drama-task-hero]').className, 'hero')
  assert.equal(doc.querySelector('textarea'), textarea); assert.equal(textarea.value, '未提交的草稿')
  doc.querySelector('[data-conversation-content]').dataset.contentPhase = 'active'; await tick()
  assert.equal(f.ui.element.isConnected, false)
  assert.equal(doc.querySelector('[data-drama-task-hero]'), null)
  assert.equal(textarea.value, '未提交的草稿')
})

test('正常聊天聚合在原程序消息位置，仅隐藏本操作成员；其他对话不变，虚拟座位重新挂载可恢复', async t => {
  const f = uiFixture(t, { phase: 'active' }), doc = f.dom.window.document, scroller = doc.querySelector('[data-conversation-scroll]')
  const seats = new Map()
  for (const id of ['user', 'start', 'assistant', 's1', 's2', 's3', 's4', 'result']) {
    const seat = doc.createElement('div'); seat.dataset.chatNodeKey = id === 'user' || id === 'assistant' ? id : `7:command${id}`
    const slot = doc.createElement('div'); slot.dataset.slot = 'conversation.chat.node'; slot.textContent = id; seat.append(slot); scroller.prepend(seat); seats.set(id, seat)
  }
  await f.ui.refresh()
  assert.equal(doc.querySelectorAll('drama-task-operation').length, 1)
  assert.equal(doc.querySelectorAll('[data-drama-operation-anchor]').length, 1)
  assert.equal(doc.querySelectorAll('[data-drama-operation-hidden]').length, 5)
  assert.equal(seats.get('assistant').textContent, 'assistant'); assert.equal(seats.get('user').hasAttribute('data-drama-operation-hidden'), false)
  for (const seat of seats.values()) seat.remove()
  await tick()
  assert.equal(doc.querySelector('drama-task-operation'), null)
  scroller.prepend(seats.get('start')); await tick()
  assert.ok(seats.get('start').querySelector('drama-task-operation'))
  f.ui.dispose()
  assert.equal(doc.querySelector('[data-drama-operation-anchor]'), null)
})

test('会话切换不串消息，旧详情响应不回写；不同操作不混组', async t => {
  let release, count = 0
  const f = uiFixture(t, { fetcher: async () => {
    if (++count === 1) return new Promise(resolve => { release = resolve })
    return { ok: true, json: async () => ({ messages: [{ ...messages[0], id: 'new-start', group_id: 'new', goal: '新会话请求' }] }) }
  } })
  f.setSession('new'); await f.ui.refresh()
  release({ ok: true, json: async () => ({ messages }) }); await tick()
  assert.match(f.operation().textContent, /新会话请求/); assert.doesNotMatch(f.operation().textContent, /完善探月基地/)
  assert.equal(groupTaskMessages([...messages, { ...messages[0], id: 'other', group_id: 'other' }]).length, 2)
})

test('失败明确停止原因和原稿保留，成功才能显示查看本次剧本及修改对比', async t => {
  let rows = structuredClone(messages)
  const f = uiFixture(t, { fetcher: async url => {
    const id = new URL(url, 'http://test').searchParams.get('id')
    return { ok: true, json: async () => ({ messages: id ? [{ ...rows.at(-1), id, box_input: boxInput, final_output: { actual_script: '基地新正文' } }] : rows }) }
  } })
  f.dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  await f.ui.refresh()
  let root = f.operation()
  await [...root.querySelectorAll('button')].find(button => button.textContent === '对比修改前后').onclick()
  assert.match(root.querySelector('dialog').textContent, /基地旧正文/); assert.match(root.querySelector('dialog').textContent, /基地新正文/)
  assert.deepEqual([...root.querySelectorAll('mark')].map(mark => mark.textContent), ['旧', '新'])
  rows = rows.map(row => ({ ...row, operation_status: 'rejected', status: row.phase === 'result' ? 'rejected' : row.status, saved: false, stop_reason: '自动修订次数达到上限', stopped_at: '4. 本地审核' }))
  await f.ui.refresh(); root = f.operation()
  assert.match(root.querySelector('drama-failure-decision').shadowRoot.textContent, /次数达到上限/)
  assert.match(root.querySelector('drama-failure-decision').shadowRoot.textContent, /已有结果仍保留/)
  assert.ok(![...root.querySelectorAll('.actions button')].some(button => button.textContent === '查看本次剧本'))
})

test('运行时展开过程展示当前步骤，终态后自动收起；用户手动展开的状态保留', async t => {
  let rows = messages.slice(0, 3).map(row => ({ ...row, operation_status: 'running', active_step: { name: '自动修订' } }))
  const f = uiFixture(t, { fetcher: async () => ({ ok: true, json: async () => ({ messages: rows }) }) })
  await f.ui.refresh(); assert.equal(f.operation().querySelector('[data-expand="process"]').open, true)
  assert.match(f.operation().textContent, /正在执行：自动修订/)
  rows = structuredClone(messages); await f.ui.refresh()
  assert.equal(f.operation().querySelector('[data-expand="process"]').open, false)
  const process = f.operation().querySelector('[data-expand="process"]'); process.querySelector('summary').onclick(); process.open = true
  rows = rows.map(row => ({ ...row, duration_seconds: 21 })); await f.ui.refresh()
  assert.equal(f.operation().querySelector('[data-expand="process"]').open, true)
})

test('详情暂时缺失可重试，不缓存空结果', async t => {
  let details = 0
  const f = uiFixture(t, { fetcher: async url => {
    const id = new URL(url, 'http://test').searchParams.get('id')
    return { ok: true, json: async () => ({ messages: id ? (++details === 1 ? [] : [{ ...messages[0], input: boxInput, box_input: boxInput }]) : messages }) }
  } })
  await f.ui.refresh()
  const input = f.operation().querySelector('[data-expand="box-input"]')
  input.open = true; await input.ontoggle()
  const retry = [...input.querySelectorAll('button')].find(button => button.textContent === '重试')
  assert.ok(retry); await retry.onclick()
  assert.match(input.textContent, /基地旧正文/)
  assert.equal(details, 2)
})

test('会话响应预载输入和步骤详情，点击立即展开且不再发详情请求；卡片头部合并为紧凑行', async t => {
  let calls = 0
  const f = uiFixture(t, { fetcher: async () => {
    calls++
    return { ok: true, json: async () => ({ messages, cursor: 200, details: messages.map(row => ({ ...row, box_input: boxInput, input: boxInput, result: step.result, rules: { review: '当次规则' } })) }) }
  } })
  await f.ui.refresh()
  const root = f.operation(), input = root.querySelector('[data-expand="box-input"]')
  assert.match(root.querySelector('.request .meta').textContent, /面板操作.*输入：当前工作稿/)
  input.querySelector('summary').click()
  assert.match(input.textContent, /基地旧正文/)
  assert.doesNotMatch(input.textContent, /正在读取/)
  const review = root.querySelector('[data-expand="step:s2"]'); review.querySelector('summary').click()
  assert.match(review.textContent, /content_issue/)
  assert.equal(calls, 1)
})

test('预载游标只随成功响应推进，会话切换清空游标及缓存，终态更新旧详情', async t => {
  let rows = messages.slice(0, 2).map(row => ({ ...row, operation_status: 'running' })), requests = []
  const f = uiFixture(t, { fetcher: async url => {
    requests.push(url)
    return { ok: true, json: async () => ({ messages: rows, cursor: 120, details: rows.map(row => ({ ...row, box_input: boxInput, input: boxInput })) }) }
  } })
  await f.ui.refresh(); await f.ui.refresh()
  assert.match(requests[0], /after=-1/); assert.match(requests[1], /after=120/); assert.match(requests[1], /pending=g/)
  rows = structuredClone(messages); await f.ui.refresh()
  await f.ui.refresh(); assert.doesNotMatch(requests.at(-1), /pending=/)
  f.setSession('new'); await f.ui.refresh(); assert.match(requests.at(-1), /after=-1/)
})

test('服务端预载只增量发送新详情，终态补齐pending任务；步骤序号不被事件序号覆盖', async () => {
  const f = displayFixture()
  const current = { actual_script: '旧正文', summary: '旧摘要', estimated_duration_seconds: 90 }
  const task = { id: 't', node_type: 'script_revision', name: '剧本优化', action: 'generate', task_status: 'running', started_at: '2026-10-22T09:00:00Z', ended_at: null,
    metadata: { project_id: 'p', session_id: 's', input_snapshot: { current_script: current, instruction: '优化' } } }
  const review = { ...step, result: { review: { status: 'passed', issues: [] } } }
  const detail = { group: { id: 'g', source: 'ui' }, tasks: [task], status: 'running', steps: [{ id: 'generate', task_id: 't', seq: 1, kind: 'generate', step_status: 'done', result: { output: { ...current, actual_script: '新正文' } } }, review] }
  const service = { ...projects, records: { scope: 'drama', tasks: { detail: () => detail } } }
  const display = createPanelTaskDisplay(f.ctx, service)
  await display(report, 'start', '剧本优化'); await display(report, 'step', '剧本优化', review)
  f.events.forEach((event, index) => { event.seq = 96 + index })
  const first = await display.read('s', { eager: true })
  assert.equal(first.details.length, 2)
  assert.equal(first.messages[1].seq, 2); assert.equal(first.messages[1].event_seq, 98)
  assert.equal(Object.hasOwn(first.messages[0], 'box_input'), false)
  assert.equal(first.details[0].box_input.current_script.actual_script, '旧正文')
  assert.equal((await display.read('s', { eager: true, after: first.cursor, pending: ['g'] })).details.length, 0)
  task.task_status = 'completed'; task.ended_at = '2026-10-22T09:01:00Z'; detail.status = 'completed'
  const ended = await display.read('s', { eager: true, after: first.cursor, pending: ['g'] })
  assert.equal(ended.details.length, 2); assert.equal(ended.details[1].final_output.actual_script, '新正文')
  assert.equal((await display.read('s', { eager: true, after: ended.cursor })).details.length, 0)
  await display(report, 'result', '剧本优化'); f.events.at(-2).seq = 110; f.events.at(-1).seq = 111
  const added = await display.read('s', { eager: true, after: ended.cursor })
  assert.equal(added.details.length, 1); assert.equal(added.details[0].phase, 'result'); assert.equal(added.cursor, 110)
})


test('执行提示在过程收起后仍可见，随步骤更新；排队及各终态不会遗留loading', async t => {
  let rows = messages.slice(0, 2).map(row => ({ ...row, operation_status: 'running', active_step: { name: '按意见修改剧本' } }))
  const f = uiFixture(t, { fetcher: async () => ({ ok: true, json: async () => ({ messages: rows }) }) })
  await f.ui.refresh()
  let root = f.operation(), status = root.querySelector('[role="status"]')
  assert.equal(status.textContent, '正在执行：按意见修改剧本')
  assert.ok(status.querySelector('.execution-spinner'))
  assert.equal(status.closest('details'), null)
  root.querySelector('[data-expand="process"]').open = false
  assert.equal(status.isConnected, true)
  rows = rows.map(row => ({ ...row, active_step: { name: '剧本本地审核' } }))
  await f.ui.refresh(); root = f.operation()
  assert.equal(root.querySelector('[data-expand="process"]').open, false)
  assert.equal(root.querySelector('[role="status"]').textContent, '正在执行：剧本本地审核')
  rows = rows.map(row => ({ ...row, active_step: null }))
  await f.ui.refresh(); assert.equal(f.operation().querySelector('[role="status"]').textContent, '正在执行中…')
  rows = rows.map(row => ({ ...row, operation_status: 'queued' }))
  await f.ui.refresh(); assert.equal(f.operation().querySelector('[role="status"]').textContent, '等待执行…')
  assert.equal(f.operation().querySelector('.execution-spinner'), null)
  for (const terminal of ['completed', 'rejected', 'failed', 'cancelled']) {
    rows = messages.map(row => ({ ...row, operation_status: terminal, status: row.phase === 'result' ? terminal : row.status }))
    await f.ui.refresh()
    assert.equal(f.operation().querySelector('[role="status"]'), null)
    assert.ok(f.operation().querySelector(['failed', 'rejected'].includes(terminal) ? 'drama-failure-decision' : '.outcome'))
  }
})

for (const action of ['continue', 'regenerate', 'stop']) test(`审核失败卡片等待用户${action}，只在点击后提交且防连点`, async t => {
  const original = structuredClone(messages)
  t.after(() => messages.splice(0, messages.length, ...original))
  messages.at(-1).operation_status = 'rejected'; messages.at(-1).status = 'rejected'
  messages.at(-1).requires_user_decision = true; messages.at(-1).saved = true
  let posts = [], release
  const response = new Promise(resolve => { release = resolve })
  const f = uiFixture(t, { fetcher: async (url, options) => {
    if (options?.method === 'POST') { posts.push({ url, body: JSON.parse(options.body) }); await response; return { ok: true, json: async () => ({ status: 'queued' }) } }
    return { ok: true, json: async () => ({ messages: structuredClone(messages) }) }
  } })
  await f.ui.refresh()
  assert.equal(posts.length, 0); assert.match(f.operation().querySelector('drama-failure-decision').shadowRoot.textContent, /等待你的选择/)
  const label = { continue: '继续修改', regenerate: '重新生成', stop: '停止' }[action]
  const failure = f.operation().querySelector('drama-failure-decision').shadowRoot
  const controls = [...failure.querySelectorAll('button')], control = controls.find(button => button.textContent === label)
  assert.ok(control); control.click(); control.click(); await tick()
  if (action === 'stop') { assert.equal(posts.length, 0); assert.match(failure.textContent, /已停止后续处理，已保存结果保留/); return }
  assert.equal(posts.length, 1); assert.equal(posts[0].body.retry_action, action); assert.equal(posts[0].body.retry_of, 'g')
  assert.ok(posts[0].body.request_id); assert.ok(control.disabled)
  release(); await tick(); assert.match(failure.textContent, /已提交/)
})

test('独立失败卡片区分审核未通过和已保存，提供本次结果及用户操作', async t => {
  const rows = messages.map(row => ({ ...row, operation_status: 'rejected', status: row.phase === 'result' ? 'rejected' : row.status, saved: true, requires_user_decision: true, stop_reason: '全部三轮仍有跨段矛盾' }))
  const f = uiFixture(t, { fetcher: async () => ({ ok: true, json: async () => ({ messages: rows }) }) })
  await f.ui.refresh()
  const card = f.operation().querySelector('drama-failure-decision').shadowRoot
  assert.match(card.textContent, /最新有效结果已自动保存/)
  assert.match(card.textContent, /审核未通过/)
  assert.deepEqual([...card.querySelectorAll('button')].map(button => button.textContent), ['继续修改', '停止', '重新生成', '任务详情'])
  assert.ok([...f.operation().querySelectorAll('button')].some(button => button.textContent === '查看本次剧本'))
})
