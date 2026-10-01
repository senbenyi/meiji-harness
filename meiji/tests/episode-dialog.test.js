import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeDialog } from '../client/overview.js'

function setup(t, generate, saved = async () => {}) {
  const dom = new JSDOM('<main></main>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { if (previous) globalThis.document = previous; else delete globalThis.document })
  t.after(() => dom.window.close())
  const root = dom.window.document.querySelector('main')
  const open = episodeDialog(root, saved, generate)
  const dialog = root.querySelector('dialog')
  dialog.showModal = () => { dialog.open = true }
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new dom.window.Event('close')) }
  open({ id: 'project', summary: { content: '总摘要' } })
  return { dom, root, open, dialog, form: dialog.querySelector('form'), generate: dialog.querySelector('.ai-summary'), input: element => element.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }
}

test('空白摘要可 AI 生成，参考时长在前，结果回填后保存实际时长', async t => {
  let saved, calls = 0
  const e = setup(t, async (_project, input) => {
    calls++
    assert.equal(input.referenceDurationSeconds, 150)
    assert.equal(input.episodeId, '')
    return { summary: '本集的故事。', durationSeconds: 160 }
  }, async (_project, input) => { saved = input })
  assert.ok(e.form.innerHTML.indexOf('name="duration"') < e.form.innerHTML.indexOf('name="summary"'))
  assert.equal(e.form.elements.summary.value, '')
  await e.generate.onclick()
  assert.equal(calls, 1)
  assert.equal(saved, undefined)
  assert.equal(e.form.elements.summary.value, '本集的故事。')
  assert.equal(e.form.elements.duration.value, '150')
  assert.match(e.dialog.querySelector('.actual-duration').textContent, /160/)
  await e.form.onsubmit({ preventDefault() {} })
  assert.equal(saved.durationSeconds, 160)
  assert.equal(e.dialog.open, false)
})

for (const action of ['input', 'close', 'stop', 'reopen']) {
  test(`生成中 ${action} 取消任务，迟到结果不覆盖输入`, async t => {
    let resolve, signal
    const e = setup(t, (_project, _input, options) => { signal = options.signal; return new Promise(done => { resolve = done }) })
    const pending = e.generate.onclick()
    if (action === 'input') { e.form.elements.summary.value = '我输入的摘要'; e.input(e.form.elements.summary) }
    else if (action === 'close') e.dialog.querySelector('.cancel').click()
    else if (action === 'stop') e.dialog.querySelector('.stop-summary').click()
    else e.open({ id: 'second' })
    assert.equal(signal.aborted, true)
    resolve({ summary: '迟到的结果', durationSeconds: 150 })
    await pending
    assert.notEqual(e.form.elements.summary.value, '迟到的结果')
    assert.equal(e.generate.disabled, false)
  })
}

test('错误保留输入；摘要显示统一计数且超过 300 字不能保存', async t => {
  let saves = 0
  const e = setup(t, async () => { throw new Error('需要网关密钥') }, async () => { saves++ })
  e.form.elements.summary.value = '已有摘要'
  await e.generate.onclick()
  assert.equal(e.form.elements.summary.value, '已有摘要')
  assert.match(e.dialog.querySelector('.error').textContent, /需要网关密钥/)
  e.form.elements.summary.value = '😀'.repeat(300) + ' \n'
  e.input(e.form.elements.summary)
  assert.match(e.dialog.querySelector('.summary-count').textContent, /^300 \/ 300/)
  assert.equal(e.form.elements.summary.validity.valid, true)
  e.form.elements.summary.value += '。'
  e.input(e.form.elements.summary)
  await e.form.onsubmit({ preventDefault() {} })
  assert.equal(saves, 0)
  assert.equal(e.form.elements.summary.validity.valid, false)
})
