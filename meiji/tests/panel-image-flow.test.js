import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { mount } from '../client/panel-app.js'
import { gateFromAction, syncImageGate } from '../client/image-review.js'
import { createLibraryEntry } from '../shared/library-rules.js'

const settle = () => new Promise(resolve => setImmediate(resolve))

test('刷新生成中的图片保留旧候选但禁用确认', () => {
 const episode = episodeFixture()
 episode.operationActivity = 'image:C01'
 episode.pendingImages = { old: { draftId: 'old', itemId: 'C01', previewUrl: '/old', name: '旅人' } }
 const gate = syncImageGate({ episodes: [episode] }, null)
 assert.equal(gate.phase, 'generating')
 assert.equal(gate.held, true)
})

test('后端图片任务失败时恢复保留的旧候选，不残留 generating', () => {
 const episode = episodeFixture()
 episode.pendingImages = { old: { draftId: 'old', itemId: 'C01', previewUrl: '/old', name: '旅人' } }
 const project = { episodes: [episode], activeRuns: [{ id: 'retry', status: 'paused', pause: { reasons: [{ code: 'step_failed', target: 'image:C01', message: '接口失败' }] } }] }
 const gate = syncImageGate(project, { ...gateFromAction('image', { episodeId: episode.id, itemId: 'C01' }), ignoreDraftId: 'old', runId: 'retry' })
 assert.equal(gate.phase, 'ready')
 assert.equal(gate.held, false)
 assert.equal(gate.draftId, 'old')
})

test('同集并发图片刷新按本卡执行锁禁用旧候选确认', () => {
 const episode = episodeFixture()
 episode.operationActivity = 'image:C01'
 episode.executionLocks = ['image:C01', 'image:E01'].map(target => ({ target, episodeId: episode.id, scope: 'episode' }))
 episode.pendingImages = { old: { draftId: 'old', itemId: 'E01', previewUrl: '/old', name: '庭院' } }
 const gate = syncImageGate({ episodes: [episode] }, null)
 assert.equal(gate.itemId, 'E01')
 assert.equal(gate.phase, 'generating')
 assert.equal(gate.held, true)
})

async function panel(t, { pending = false, failure = false } = {}) {
 const e = await setupModel(t), project = await e.store.read(e.id)
 const character = project.episodes[0].plot.characters.items[0]
 const { entry, variant } = createLibraryEntry(project, 'characters', character)
 character.ref = { libraryId: entry.id, variantId: variant.id }
 if (pending) {
  project.episodes[0].pendingImages = { old: { draftId: 'old', itemId: project.episodes[0].plot.scenes.items[0].id, name: '庭院', previewUrl: '/old', aspect: '1344x768' } }
 }
 const dom = new JSDOM('<body></body>', { url: 'http://localhost', pretendToBeVisual: true })
 const keys = ['window', 'document', 'localStorage', 'MutationObserver', 'requestAnimationFrame', 'fetch', 'setInterval', 'CustomEvent', 'Event']
 const prior = Object.fromEntries(keys.map(key => [key, globalThis[key]])), observers = [], calls = []
 Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
  MutationObserver: class extends dom.window.MutationObserver { constructor(callback) { super(callback); observers.push(this) } },
  requestAnimationFrame: callback => dom.window.requestAnimationFrame(callback), setInterval: () => 1,
  fetch: async (url, options = {}) => {
   const path = new URL(url, 'http://localhost').pathname.replace('/plugins/meiji/', '')
   calls.push({ path, method: options.method || 'GET', body: options.body && JSON.parse(options.body) })
   if (path === 'image-review') {
    if (JSON.parse(options.body).action === 'discard-image') delete project.episodes[0].pendingImages.old
    return { ok: true, json: async () => ({ project: structuredClone(project) }) }
   }
   if (path === 'runs' && options.method === 'POST') {
    if (failure) return { ok: false, status: 400, json: async () => ({ error: '目标校验失败' }) }
    return { ok: true, json: async () => ({ run: { id: 'new-run', steps: [] }, prereq: [{ key: 'story@all', message: '前置资料' }], blockers: [], deletions: [] }) }
   }
   const data = path === 'link' ? { projectId: e.id, workspace: null }
    : path === 'projects/' + e.id ? { project } : path === 'runs' ? { runs: [] }
    : path === 'runs/new-run/preview' ? { run: { id: 'new-run', steps: [] }, prereq: [{ key: 'story@all', message: '前置资料' }], blockers: [], deletions: [] }
    : path === 'runs/new-run/cancel' ? { run: { id: 'new-run', status: 'cancelled' } }
    : path === 'operations/current' ? { operations: [] } : path === 'assets' ? { assets: [] } : null
   assert.ok(data, path)
   return { ok: true, json: async () => structuredClone(data) }
  },
 })
 dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
 dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
 t.after(() => { observers.forEach(observer => observer.disconnect()); dom.window.close(); Object.assign(globalThis, prior) })
 localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-11111111-1111-4111-8111-111111111111' }))
 mount(); await settle(); await settle()
 const root = document.querySelector('meiji-workbench').shadowRoot
 if (pending) {
  assert.equal(root.querySelector('.image-review-overlay'), null)
  ;[...root.querySelectorAll('button')].find(button => button.textContent === '查看场景详情').click()
 } else {
  // 从概要进入实际人物详情，后续按钮使用 mount 内的真实 actions。
  root.querySelector('.episode-card').click(); await settle(); await settle()
  ;[...root.querySelectorAll('.stage')].find(button => button.textContent === '本集资产').click()
  assert.ok(root.querySelector('[aria-label="人物详情：旅人"]'), root.textContent)
  root.querySelector('[aria-label="人物详情：旅人"]').click()
 }
 await settle(); await settle()
 return { root, calls, project }
}

test('mounted 面板首次生图取消 Run 预览后退出忙碌', async t => {
 const { root, calls } = await panel(t)
 assert.match(root.textContent, /旅人 · 人物资料/)
 assert.ok(root.querySelector('[aria-label="年龄"]'))
 const generate = root.querySelector('[aria-label="重新生成角色图片：旅人"]')
 assert.ok(generate, root.textContent)
 generate.click(); await settle(); await settle()
 const dialog = root.querySelector('.run-preview-dialog')
 assert.ok(dialog)
 ;[...dialog.querySelectorAll('button')].find(button => button.textContent === '取消').click()
 await settle(); await settle()
 assert.equal(root.querySelector('[aria-label="重新生成角色图片：旅人"]').disabled, false)
 assert.equal(root.querySelector('.detail-image-actions'), null)
 assert.ok(calls.some(call => call.path === 'runs/new-run/cancel'))
})

for (const failure of [false, true]) test(`mounted 候选图重新生成${failure ? '请求失败' : '预览取消'}后旧图可继续确认`, async t => {
 const { root, calls, project } = await panel(t, { pending: true, failure })
 const regenerate = [...root.querySelectorAll('.detail-image-buttons button')].find(button => button.textContent === '重新生成')
 assert.ok(regenerate, root.textContent)
 regenerate.click(); await settle(); await settle()
 if (!failure) {
  const dialog = root.querySelector('.run-preview-dialog'); assert.ok(dialog)
  ;[...dialog.querySelectorAll('button')].find(button => button.textContent === '取消').click()
  await settle(); await settle()
 }
 const confirm = root.querySelector('.detail-image-buttons .primary')
 assert.ok(confirm)
 assert.equal(confirm.disabled, false)
 assert.ok(project.episodes[0].pendingImages.old)
 assert.ok(!calls.some(call => call.body?.action === 'discard-image'))
 assert.equal(calls.find(call => call.path === 'runs' && call.method === 'POST').body.goal.image.draftId, 'old')
})
