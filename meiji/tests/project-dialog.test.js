import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { projectDialog } from '../client/session.js'

function setup(t, create) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { document: globalThis.document, FormData: globalThis.FormData }
  Object.assign(globalThis, { document: dom.window.document, FormData: dom.window.FormData })
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const root = dom.window.document.querySelector('main'), open = projectDialog(root, create)
  open()
  const dialog = root.querySelector('dialog'), form = dialog.querySelector('form')
  form.elements.title.value = '测试项目'; form.elements.style.value = '写实电影'; form.elements.summary.value = '项目摘要'
  return { root, dialog, form, submit: () => form.onsubmit({ preventDefault() {} }) }
}

test('successful creation closes dialog and overlay and prevents duplicate submissions', async t => {
  let resolve, calls = 0
  const e = setup(t, input => { calls++; assert.equal(input.title, '测试项目'); return new Promise(done => { resolve = done }) })
  const pending = e.submit()
  assert.equal(e.form.querySelector('[type=submit]').disabled, true)
  await e.submit(); assert.equal(calls, 1)
  resolve(); await pending
  assert.equal(e.dialog.open, false)
  assert.equal(e.root.querySelector('.panel-dialog-overlay'), null)
})

test('failed creation preserves inputs and allows retry', async t => {
  let calls = 0
  const e = setup(t, async () => { if (++calls === 1) throw new Error('创建失败') })
  await e.submit()
  assert.equal(e.dialog.open, true)
  assert.equal(e.form.elements.title.value, '测试项目')
  assert.equal(e.form.querySelector('[type=submit]').disabled, false)
  assert.equal(e.dialog.querySelector('.error').textContent, '创建失败')
  await e.submit(); assert.equal(e.dialog.open, false)
})
