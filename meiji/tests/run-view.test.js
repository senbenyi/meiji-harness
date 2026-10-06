import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderRunList } from '../client/run-list.js'
import { renderRunDetail } from '../client/run-detail.js'
import { runInScope, runTargetMatches } from '../shared/run-view.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<body></body>'), previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; dom.window.close() })
}
const project = { episodes: [{ id: 'e2' }, { id: 'e1' }] }
const row = (id, fields = {}) => ({ id, episodeId: 'e2', goal: { to: 'film' }, status: 'completed', initiator: 'panel', createdAt: '2026-10-06T01:00:00Z', done: 2, total: 2, targets: ['film:S03'], ...fields })
const button = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text)

test('第2集单镜历史只显示所属与受影响的任务，点击传递对象高亮且可清除对象筛选', async t => {
  setup(t); let opened
  const records = [row('e2s3'), row('e1s3', { episodeId: 'e1' }), row('e2s4', { targets: ['film:S04'] }), row('affected', { episodeId: null, affectedEpisodes: ['e2'] })]
  const view = renderRunList(project, { load: async () => ({ runs: records }), episodeId: 'e2', target: 'storyboard:S03,film:S03', open: (...args) => { opened = args } })
  document.body.append(view); await settle()
  assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['e2s3', 'affected'])
  assert.match(view.textContent, /由项目级任务影响/)
  view.querySelector('[data-run-id=e2s3] button').click()
  assert.equal(opened[0].id, 'e2s3'); assert.equal(opened[1], 'storyboard:S03,film:S03')
  const filter = view.querySelector('[aria-label=按对象筛选]'); filter.value = ''; filter.dispatchEvent(new document.defaultView.Event('change'))
  assert.equal(view.querySelectorAll('[data-run-id]').length, 3)
  await view.refresh(); assert.equal(filter.value, '')
})

test('项目级范围、状态与发起方可组合筛选，暂停置顶且不加载任何步骤正文', async t => {
  setup(t)
  const records = [row('done'), row('paused', { status: 'paused', pendingCount: 1, initiator: 'session' }), row('project', { episodeId: null })]
  const view = renderRunList(project, { load: async () => ({ runs: records }) }); document.body.append(view); await settle()
  assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'paused')
  assert.equal(view.querySelector('details'), null); assert.match(view.textContent, /待处理 1/)
  button(view, '项目级').click(); assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['project'])
  button(view, '全部（1）').click()
  const filter = view.querySelector('[aria-label=按发起方筛选]'); filter.value = 'session'; filter.dispatchEvent(new document.defaultView.Event('change'))
  assert.deepEqual([...view.querySelectorAll('[data-run-id]')].map(node => node.dataset.runId), ['paused'])
  assert.ok(!view.textContent.includes('操作')); assert.ok(!view.textContent.includes('任务编号'))
})

test('详情按对象展开快照与原始返回，保留作废步骤，刷新保持展开和高亮', async t => {
  setup(t); const calls = []
  const run = { ...row('run'), status: 'paused', steps: [
    { id: 'old', kind: 'generate', target: 'film:S03', status: 'superseded', origin: 'plan' },
    { id: 'step', kind: 'review', target: 'film:S03', status: 'paused', origin: 'review-fail', prompts: ['p'], responses: ['r'], artifacts: ['a'] },
    { id: 'other', kind: 'video', target: 'film:S04', status: 'done', origin: 'plan' },
  ], events: [{ type: 'paused', at: '2026-10-06T02:00:00Z', stepIds: ['step'] }] }
  const view = renderRunDetail(project, { target: 'storyboard:S03,film:S03', load: async () => ({ run }), loadRecords: async (value, step, kind) => {
    calls.push([value.id, step.id, kind]); return kind === 'artifacts' ? { artifacts: [{ target: 'film:S03', published: true, content: '<script>safe()</script>草稿' }] } : { [kind]: [{ body: '原始全文', durationMs: 99, prompt: '完整提示词' }] }
  } }); document.body.append(view); await settle()
  assert.equal(view.querySelector('.is-superseded').open, false); assert.equal(view.querySelector('.is-highlighted').dataset.target, 'film:S03')
  assert.equal(calls.length, 0)
  const detail = view.querySelector('[data-step-id=step]'); detail.open = true; await detail.ontoggle(); await settle()
  assert.match(detail.textContent, /草稿/); assert.equal(detail.querySelector('script'), null)
  assert.deepEqual(calls[0], ['run', 'step', 'artifacts'])
  button(detail, '查看原始返回').click(); await settle(); assert.match(document.querySelector('dialog').textContent, /原始全文/)
  document.querySelector('dialog').close(); await view.refresh()
  assert.equal(view.querySelector('[data-step-id=step]').open, true); assert.match(view.textContent, /任务已暂停/)
  assert.ok(!view.textContent.includes('任务编号')); assert.ok(!view.textContent.includes('所属操作'))
})

test('详情只显示原因授权的动作，重试失败可再次点击并取消分支', async t => {
  setup(t); let calls = 0; const controls = []
  const run = { ...row('run'), status: 'paused', steps: [], events: [], pause: { reasons: [{ stepId: 'failed', message: '网络失败', actions: ['retry', 'cancel-branch', 'override'] }] } }
  const view = renderRunDetail(project, { load: async () => ({ run }), control: async (_, endpoint, fields) => { controls.push([endpoint, fields]); if (++calls === 1) throw new Error('临时不可用') } })
  document.body.append(view); await settle()
  assert.ok(button(view, '忽略并通过'))
  button(view, '重试此步骤').click(); await settle(); assert.match(view.textContent, /临时不可用/); assert.equal(button(view, '重试此步骤').disabled, false)
  button(view, '重试此步骤').click(); await settle()
  assert.deepEqual(controls[1], ['resume', { action: 'retry', stepId: 'failed' }])
  button(view, '取消此分支').click(); await settle(); assert.deepEqual(controls[2], ['cancel', { stepId: 'failed' }])
})

test('列表拒绝迟到的旧刷新结果，加载错误可以重试', async t => {
  setup(t); const first = Promise.withResolvers(); let count = 0
  const view = renderRunList(project, { load: async () => ++count === 1 ? first.promise : count === 2 ? { runs: [row('latest')] } : count === 3 ? Promise.reject(new Error('断线')) : { runs: [row('recovered')] } })
  document.body.append(view); await view.refresh(); first.resolve({ runs: [row('old')] }); await settle()
  assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'latest')
  await view.refresh(); assert.match(view.textContent, /断线/); button(view, '刷新').click(); await settle(); assert.equal(view.querySelector('[data-run-id]').dataset.runId, 'recovered')
})

test('对象通配只匹配给定前缀，项目级只匹配全部、项目级与 affectedEpisodes', () => {
  assert.equal(runTargetMatches('film:S03', 'film:*'), true)
  assert.equal(runTargetMatches('film:S03', 'film:S01,film:S03'), true)
  assert.equal(runTargetMatches('seconds:S03', 'film:*'), false)
  assert.equal(runInScope({ episodeId: null }, 'e2'), false)
  assert.equal(runInScope({ episodeId: null, affectedEpisodes: ['e2'] }, 'e2'), true)
  assert.equal(runInScope({ episodeId: 'e1' }, 'project'), false)
})
