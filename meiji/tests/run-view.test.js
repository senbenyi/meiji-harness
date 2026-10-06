import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderRunList } from '../client/run-list.js'
import { renderRunDetail } from '../client/run-detail.js'
import { runInScope, runTargetMatches, runDisplayStatus } from '../shared/run-view.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<body></body>'), previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; dom.window.close() })
}
const project = { title: '穿越成化雄', episodes: [{ id: 'e2' }, { id: 'e1' }] }
const row = (id, fields = {}) => ({ id, episodeId: 'e2', goal: { to: 'film' }, status: 'completed', initiator: 'panel', createdAt: '2026-10-06T01:00:00Z', done: 2, total: 2, targets: ['film:S03'], ...fields })
const button = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text)

test('第2集单镜历史只显示所属与受影响的任务，点击传递对象高亮且可清除对象筛选', async t => {
  setup(t); let opened
  const records = [row('e2s3'), row('e1s3', { episodeId: 'e1' }), row('e2s4', { targets: ['film:S04'] }), row('affected', { episodeId: null, affectedEpisodes: ['e2'] })]
  const view = renderRunList(project, { load: async () => ({ runs: records }), episodeId: 'e2', target: 'storyboard:S03,film:S03', open: (...args) => { opened = args } })
  document.body.append(view); await settle()
  assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['e2s3', 'affected'])
  assert.match(view.querySelector('h2').textContent, /穿越成化雄/)
  assert.equal(button(view, '刷新'), undefined)
  view.querySelector('[data-run-id=e2s3]').click()
  assert.equal(opened[0].id, 'e2s3'); assert.equal(opened[1], 'storyboard:S03,film:S03')
  const filter = view.querySelector('[aria-label=按对象筛选]'); filter.value = ''; filter.dispatchEvent(new document.defaultView.Event('change'))
  assert.equal(view.querySelectorAll('[data-run-id]').length, 3)
  await view.refresh(); assert.equal(filter.value, '')
})

test('状态、对象与选集可组合筛选，暂停置顶且不加载任何步骤正文', async t => {
  setup(t)
  const records = [row('done', { createdAt: '2026-10-06T01:00:00Z' }), row('paused', { status: 'paused', pendingCount: 1, initiator: 'session', createdAt: '2026-10-06T02:00:00Z' }), row('project', { episodeId: null, createdAt: '2026-10-06T00:00:00Z' })]
  const view = renderRunList(project, { load: async () => ({ runs: records }) }); document.body.append(view); await settle()
  assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'paused')
  assert.equal(view.querySelectorAll('.task-history-list > h3').length, 0)
  assert.equal(view.querySelector('details'), null); assert.match(view.textContent, /待处理 1/)
  const episode = view.querySelector('[aria-label=按选集筛选]'); episode.value = 'e2'; episode.dispatchEvent(new document.defaultView.Event('change'))
  assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['paused', 'done'])
  const status = view.querySelector('[aria-label=按任务状态筛选]'); status.value = 'completed'; status.dispatchEvent(new document.defaultView.Event('change'))
  assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['done'])
  assert.equal(view.querySelector('[aria-label=按发起方筛选]'), null)
  assert.equal(view.querySelector('.run-scopes'), null)
  assert.ok(!view.textContent.includes('操作')); assert.ok(!view.textContent.includes('任务编号'))
})

test('详情直接展示步骤状态与失败原因，提示词和错误信息可复制', async t => {
  setup(t); const calls = []
  const run = { ...row('run'), status: 'paused', steps: [
    { id: 'old', kind: 'generate', target: 'film:S03', status: 'superseded', origin: 'plan' },
    { id: 'step', kind: 'review', target: 'film:S03', status: 'paused', origin: 'review-fail', error: '审核服务异常', output: { passed: false, issues: ['画面不完整'] }, prompts: ['p'], responses: ['response-id'], artifacts: ['a'] },
    { id: 'other', kind: 'video', target: 'film:S04', status: 'done', origin: 'plan' },
  ], events: [{ type: 'paused', at: '2026-10-06T02:00:00Z', stepIds: ['step'] }] }
  const view = renderRunDetail(project, { target: 'storyboard:S03,film:S03', load: async () => ({ run }), loadRecords: async (value, step, kind) => {
    calls.push([value.id, step.id, kind]); return kind === 'artifacts' ? { artifacts: [{ target: 'film:S03', published: true, content: '<script>safe()</script>草稿' }] } : kind === 'responses' ? { responses: [{ method: 'POST', path: '/v1/chat', status: 200, request: { body: '原始请求' }, body: '原始全文' }] } : { prompts: [{ body: '原始全文', durationMs: 99, prompt: '完整提示词' }] }
  } }); document.body.append(view); await settle()
  assert.equal(view.querySelectorAll('.task-history-header > button').length, 1)
  assert.match(view.querySelector('.run-detail-status').textContent, /未通过/)
  assert.equal(view.querySelector('.run-step-card.is-superseded').textContent.includes('已作废'), true); assert.equal(view.querySelector('.is-highlighted').dataset.target, 'film:S03')
  assert.equal(calls.length, 0)
  const detail = view.querySelector('[data-step-id=step]')
  assert.match(detail.textContent, /待处理/); assert.match(detail.textContent, /审核未通过/)
  assert.equal(detail.open, true); assert.equal(view.querySelector('[data-step-id=other]').open, false)
  assert.equal(detail.querySelector('.run-step-expand-state').textContent, '收起详情')
  detail.open = false; detail.dispatchEvent(new document.defaultView.Event('toggle')); assert.equal(detail.querySelector('.run-step-expand-state').textContent, '展开详情')
  detail.open = true; detail.dispatchEvent(new document.defaultView.Event('toggle')); assert.equal(detail.querySelector('.run-step-expand-state').textContent, '收起详情')
  assert.match(detail.querySelector('.run-step-heading').textContent, /审核未通过/)
  assert.match(detail.querySelector('.run-step-heading').textContent, /自审成片 · S03/)
  assert.match(view.querySelector('[data-step-id=old] .run-step-heading').textContent, /生成成片 · S03/)
  assert.equal(detail.querySelector('.run-step-status-detail').textContent.includes('状态：'), false)
  assert.ok(detail.querySelector('.run-step-detail .run-step-summary-actions'))
  assert.ok(button(detail, '查看提示词')); assert.ok(button(detail, '查看 HTTP 请求')); assert.equal(button(detail, '查看原始返回'), undefined); assert.ok(button(detail, '复制'))
  button(detail, '查看提示词').click(); await settle(); assert.match(view.textContent, /完整提示词/); assert.ok(view.querySelector('.run-record-page .json-copy'))
  button(view, '← 返回').click(); await settle()
  const current = view.querySelector('[data-step-id=step]')
  button(current, '查看 HTTP 请求').click(); await settle(); assert.match(view.textContent, /原始请求/); assert.match(view.textContent, /原始全文/); assert.ok(view.querySelector('.run-record-page .json-copy')); assert.ok(view.querySelector('[aria-selected=true]'))
  button(view, '← 返回').click(); await settle()
  const detailAfterReturn = view.querySelector('[data-step-id=step]')
  assert.equal(detailAfterReturn.querySelector('details'), null); assert.ok(detailAfterReturn.querySelector('summary'))
  assert.ok(button(detailAfterReturn, '查看生成快照'))
  button(detailAfterReturn, '查看生成快照').click(); await settle()
  assert.match(view.textContent, /生成快照详情/); assert.match(view.textContent, /草稿/); assert.equal(view.querySelector('script'), null)
  assert.ok(view.querySelector('.run-record-page .json-copy'))
  assert.deepEqual(calls.at(-1), ['run', 'step', 'artifacts'])
  assert.ok(!view.textContent.includes('任务编号')); assert.ok(!view.textContent.includes('所属操作'))
})

test('详情中的处理原因仅供查看并支持复制，不展示流程操作', async t => {
  const run = { ...row('run'), status: 'paused', steps: [], events: [], pause: { reasons: [{ stepId: 'failed', message: '网络失败', actions: ['retry', 'cancel-branch', 'override'] }] } }
  setup(t)
  const view = renderRunDetail(project, { load: async () => ({ run }) })
  document.body.append(view); await settle()
  assert.match(view.textContent, /网络失败/); assert.ok(button(view, '复制'))
  assert.equal(button(view, '忽略并通过'), undefined); assert.equal(button(view, '重试此步骤'), undefined); assert.equal(button(view, '取消此分支'), undefined)
  assert.equal(button(view, '提交意见并继续'), undefined); assert.equal(button(view, '重新生成'), undefined); assert.equal(view.querySelector('.run-feedback'), null)
})

test('列表拒绝迟到的旧刷新结果，加载错误可以重试', async t => {
  setup(t); const first = Promise.withResolvers(); let count = 0
  const view = renderRunList(project, { load: async () => ++count === 1 ? first.promise : count === 2 ? { runs: [row('latest')] } : count === 3 ? Promise.reject(new Error('断线')) : { runs: [row('recovered')] } })
  document.body.append(view); await view.refresh(); first.resolve({ runs: [row('old')] }); await settle()
  assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'latest')
  await view.refresh(); assert.match(view.textContent, /断线/); await view.refresh(); await settle(); assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'recovered')
})

test('对象通配只匹配给定前缀，项目级只匹配全部、项目级与 affectedEpisodes', () => {
  assert.equal(runTargetMatches('film:S03', 'film:*'), true)
  assert.equal(runTargetMatches('film:S03', 'film:S01,film:S03'), true)
  assert.equal(runTargetMatches('seconds:S03', 'film:*'), false)
  assert.equal(runInScope({ episodeId: null }, 'e2'), false)
  assert.equal(runInScope({ episodeId: null, affectedEpisodes: ['e2'] }, 'e2'), true)
  assert.equal(runInScope({ episodeId: 'e1' }, 'project'), false)
})

test('被动中断结束的任务显示为未通过，与待处理和已取消区分', () => {
  assert.deepEqual(runDisplayStatus({ status: 'failed', steps: [] }), { key: 'failed', label: '未通过' })
  assert.deepEqual(runDisplayStatus({ status: 'paused', pause: { reasons: [{ code: 'wait_confirm' }] }, steps: [] }), { key: 'paused', label: '待处理' })
  assert.deepEqual(runDisplayStatus({ status: 'cancelled', steps: [] }), { key: 'cancelled', label: '已取消' })
})
