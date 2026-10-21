import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createShell } from '../src/client/panel-shell.js'

function fixture(t, width = 1440) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  return dom
}

test('按meiji模式挂在body，键盘调宽与页面让位同步，重建保留宽度', t => {
  fixture(t)
  let shell = createShell()
  assert.equal(document.getElementById('drama-panel').parentElement, document.body)
  const handle = shell.root.querySelector('.resize-handle')
  handle.onkeydown({ key: 'ArrowLeft', preventDefault() {} })
  assert.equal(localStorage.getItem('drama-panel-width'), '376')
  assert.equal(document.documentElement.style.getPropertyValue('--drama-panel-width'), '376px')
  assert.equal(handle.getAttribute('aria-valuenow'), '376')
  shell.dispose()
  assert.equal(document.getElementById('drama-panel'), null)
  assert.equal(document.documentElement.style.getPropertyValue('--drama-panel-width'), '')
  assert.equal(document.head.querySelector('style'), null)
  shell = createShell()
  assert.equal(shell.root.querySelector('.resize-handle').getAttribute('aria-valuenow'), '376')
  shell.dispose()
})

test('指针拖动保存宽度，折叠48px，展开恢复，销毁清理拖动标记', t => {
  fixture(t)
  const shell = createShell(), handle = shell.root.querySelector('.resize-handle')
  handle.setPointerCapture = () => {}
  handle.onpointerdown({ button: 0, pointerId: 1, clientX: 1000, preventDefault() {} })
  handle.onpointermove({ pointerId: 1, clientX: 900 })
  handle.onpointerup()
  assert.equal(localStorage.getItem('drama-panel-width'), '460')
  shell.setOpen(false)
  assert.equal(document.documentElement.style.getPropertyValue('--drama-panel-width'), '48px')
  assert.equal(shell.toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(shell.toggle.getAttribute('aria-label'), '展开右侧面板')
  assert.equal(shell.toggle.querySelector('svg').getAttribute('aria-hidden'), 'true')
  assert.equal(shell.toggle.querySelectorAll('svg path').length, 2)
  shell.toggle.click()
  assert.equal(shell.toggle.getAttribute('aria-label'), '收起右侧面板')
  assert.equal(document.documentElement.style.getPropertyValue('--drama-panel-width'), '460px')
  handle.onpointerdown({ button: 0, pointerId: 2, clientX: 900, preventDefault() {} })
  shell.dispose()
  assert.equal(document.documentElement.hasAttribute('data-drama-resizing'), false)
})

test('移动端沿用meiji背景隐藏标记，折叠或销毁恢复', t => {
  fixture(t, 600)
  const shell = createShell()
  assert.equal(document.documentElement.dataset.dramaMobile, 'open')
  shell.setOpen(false)
  assert.equal(document.documentElement.dataset.dramaMobile, 'closed')
  shell.dispose()
  assert.equal(document.documentElement.dataset.dramaMobile, undefined)
})
