import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { goalRequest } from '../client/goal-request.js'
import { confirmRunPreview } from '../client/run-preview.js'
import { createBridge } from '../client/chat-bridge.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' }), prior = Object.fromEntries(['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of ['document', 'window']) Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window.document, configurable: true })
  dom.window.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-11111111-1111-4111-8111-111111111111' }))
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { for (const [key, descriptor] of Object.entries(prior)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; dom.window.close() })
}
test('生成按钮转换目标，单镜意见给出 tracks，编辑仍是即时请求', () => {
  assert.deepEqual(goalRequest('revise-shot', { track: 'S03', review: '缩短对白' }).goal, { to: 'shots', scope: { tracks: ['S03'] }, mode: 'modify', feedback: '缩短对白' })
  assert.equal(goalRequest('outline-text', { outline: {} }), null)
  assert.equal(goalRequest('image', { itemId: 'C01' }).goal.to, 'images')
})
test('缺少的前置默认纳入并展示随之增加的删除清单，可取消勾选，确认返回明确选择', async t => {
  setup(t); const choices = []
  const initial = { run: { id: 'run', steps: [{ target: 'outline' }] }, prereq: [{ key: 'summary@all', message: '摘要前置' }], deletions: [], blockers: [] }
  const promise = confirmRunPreview(document.body, initial, { refresh: async value => { choices.push(value); return { ...initial, deletions: value.length ? [{ label: '镜头表' }] : [], projectRevision: 4 } } })
  await settle()
  assert.equal(document.querySelector('input').checked, true)
  assert.match(document.querySelector('dialog').textContent, /镜头表/)
  const check = document.querySelector('input'); check.checked = false; check.dispatchEvent(new window.Event('change')); await settle()
  assert.doesNotMatch(document.querySelector('dialog').textContent, /镜头表/)
  const again = document.querySelector('input'); again.checked = true; again.dispatchEvent(new window.Event('change')); await settle()
  document.querySelector('.primary').click()
  assert.deepEqual(choices, [['summary@all'], [], ['summary@all']]); assert.deepEqual(await promise, { authorizePrereq: ['summary@all'], confirmDelete: true, projectRevision: 4 })
})
test('没有前置、删除和阻断时多个对象或并入任务也不弹窗', async t => {
  setup(t)
  const plain = { run: { id: 'run', steps: [{ target: 'outline' }, { target: 'characters' }] }, prereq: [], deletions: [], blockers: [], projectRevision: 2 }
  assert.deepEqual(await confirmRunPreview(document.body, plain), { authorizePrereq: [], confirmDelete: true, projectRevision: 2 })
  assert.deepEqual(await confirmRunPreview(document.body, { ...plain, amend: true }), { authorizePrereq: [], confirmDelete: true, projectRevision: 2 })
  assert.equal(document.querySelector('dialog'), null)
})
test('无删除或前置的单对象不弹窗，生成只调用 Run 预览和确认', async t => {
  setup(t); const calls = []
  const bridge = createBridge({ request: async (path, options) => {
    calls.push([path, JSON.parse(options.body)])
    return path === 'runs' ? { run: { id: 'run', steps: [{ target: 'outline' }] }, prereq: [], deletions: [], blockers: [] } : { run: { id: 'run', status: 'running' } }
  }, jsonBody: body => ({ body: JSON.stringify(body) }), status: () => {} })
  const result = await bridge.perform({ id: 'project' }, 'outline')
  assert.deepEqual(calls.map(([path]) => path), ['runs', 'runs/run/confirm'])
  assert.equal(result.runId, 'run'); assert.equal(document.querySelector('dialog'), null)
})
test('并入任务关闭预览不会取消原任务；硬阻断禁止确认', async t => {
  setup(t)
  const promise = confirmRunPreview(document.body, { amend: true, run: { steps: [] }, blockers: [{ message: '没有目标' }] })
  assert.match(document.querySelector('dialog').textContent, /并入当前任务/); assert.equal(document.querySelector('.primary').disabled, true)
  ;[...document.querySelectorAll('button')].find(button => button.textContent === '取消').click()
  assert.equal(await promise, null)
})
