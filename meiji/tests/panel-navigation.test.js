import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { setupModel } from './fixtures/model.js'
import { mount } from '../client/panel-app.js'
const settle = () => new Promise(resolve => setImmediate(resolve))

test('片库和设置返回概要，新会话不残留项目，后台刷新不抢占页面', async t => {
  const e = await setupModel(t), project = await e.store.read(e.id)
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true })
  const names = ['window', 'document', 'localStorage', 'MutationObserver', 'requestAnimationFrame', 'fetch', 'setInterval']
  const previous = Object.fromEntries(names.map(key => [key, globalThis[key]]))
  const observers = []
  let poll, linked = true
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    MutationObserver: class extends dom.window.MutationObserver { constructor(callback) { super(callback); observers.push(this) } }, requestAnimationFrame: callback => dom.window.requestAnimationFrame(callback),
    setInterval: callback => { poll ||= callback; return 1 },
    fetch: async url => {
      const path = new URL(url, 'http://localhost').pathname.replace('/plugins/meiji/', '')
      const data = path === 'link' ? { projectId: linked ? e.id : null, workspace: null } : path === 'projects/' + e.id ? { project } : path === 'operations/current' ? { operations: [] } : path === 'runs' ? { runs: [] } : path === 'projects' ? { projects: [project] } : path === 'assets' ? { assets: [] } : null
      assert.ok(data, path)
      return { ok: true, json: async () => structuredClone(data) }
    },
  })
  t.after(() => { observers.forEach(observer => observer.disconnect()); dom.window.close(); Object.assign(globalThis, previous) })
  localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-test' }))
  mount(); await settle()
  const root = document.querySelector('meiji-workbench').shadowRoot
  const click = text => [...root.querySelectorAll('button')].find(button => button.textContent === text).click()
  assert.ok(root.querySelector('.overview-page'))
  click('查看任务历史 →'); await settle()
  assert.ok(root.querySelector('.run-list-page'))
  await poll(); await settle()
  assert.ok(root.querySelector('.run-list-page'))
  click('← 返回'); await settle()
  assert.ok(root.querySelector('.overview-page'))
  root.querySelector('.library').click(); await settle()
  await poll(); await settle()
  assert.ok(root.querySelector('.library-view'))
  root.querySelector('.brand').click(); await settle()
  assert.ok(root.querySelector('.overview-page'))
  root.querySelector('.settings').click(); await settle()
  assert.ok(root.querySelector('.settings-page'))
  click('← 返回项目'); await settle()
  assert.ok(root.querySelector('.overview-page'))
  linked = false; localStorage.removeItem('dsh.sessions.current')
  await poll(); await settle()
  assert.match(root.textContent, /当前会话未关联项目，可以直接聊天；创建或选择短剧后再开始制作/)
  assert.equal(root.querySelector('.workspace-bind'), null)
  assert.ok([...root.querySelectorAll('button')].some(button => button.textContent === '创建项目'))
  assert.equal(root.querySelector('.overview-page'), null)
})
