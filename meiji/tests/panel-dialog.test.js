import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { showPanelDialog } from '../client/dom.js'

function setup(t) {
  const dom = new JSDOM('<main id="chat"><input></main><meiji-workbench></meiji-workbench>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  const root = dom.window.document.querySelector('meiji-workbench').attachShadow({ mode: 'open' })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.showModal = () => { throw new Error('不能遮罩全页') }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const add = () => { const dialog = dom.window.document.createElement('dialog'); root.append(dialog); return dialog }
  const escape = () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  return { dom, root, add, escape }
}

test('panel dialog leaves the conversation available and removes its overlay on close', t => {
  const e = setup(t), dialog = e.add()
  showPanelDialog(dialog)
  showPanelDialog(dialog)
  assert.equal(e.root.querySelectorAll('.panel-dialog-overlay').length, 1)
  assert.equal(e.dom.window.document.querySelector('.panel-dialog-overlay'), null)
  const chat = e.dom.window.document.querySelector('#chat input')
  chat.focus()
  assert.equal(e.dom.window.document.activeElement, chat)
  e.escape()
  assert.equal(dialog.open, false)
  assert.equal(e.root.querySelector('.panel-dialog-overlay'), null)
})

test('Escape closes only the last dialog and honors a prevented cancel', t => {
  const e = setup(t), first = e.add(), second = e.add()
  showPanelDialog(first)
  showPanelDialog(second)
  const prevent = event => event.preventDefault()
  second.addEventListener('cancel', prevent)
  e.escape()
  assert.equal(second.open, true)
  second.removeEventListener('cancel', prevent)
  e.escape()
  assert.equal(second.open, false)
  assert.equal(first.open, true)
  e.escape()
  assert.equal(first.open, false)
  showPanelDialog(first)
  e.escape()
  assert.equal(first.open, false)
})
