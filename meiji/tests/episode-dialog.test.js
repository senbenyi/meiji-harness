import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeDialog } from '../client/project-overview-view.js'

function setup(t, generate, saved = async () => {}) {
  const dom = new JSDOM('<main></main>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { if (previous) globalThis.document = previous; else delete globalThis.document })
  t.after(() => dom.window.close())
  const root = dom.window.document.querySelector('main')
  const open = episodeDialog(root, saved, generate)
  const dialog = root.querySelector('dialog')
  dialog.show = () => { dialog.open = true }
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new dom.window.Event('close')) }
  open({ id: 'project', summary: { content: '总摘要' } })
  return { dom, root, open, dialog, form: dialog.querySelector('form'), generate: dialog.querySelector('.ai-summary'), input: element => element.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }
}

test('空白摘要可 AI 生成，时长在前，结果回填后保存用户设定的时长', async t => {
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
  assert.equal(e.dialog.querySelector('.actual-duration'), null)
  await e.form.onsubmit({ preventDefault() {} })
  assert.equal(saved.durationSeconds, 150)
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

test('错误保留输入；摘要仅显示字数，超过旧上限仍完整保存', async t => {
  let saved
  const e = setup(t, async () => { throw new Error('需要网关密钥') }, async (_project, input) => { saved = input })
  e.form.elements.summary.value = '已有摘要'
  await e.generate.onclick()
  assert.equal(e.form.elements.summary.value, '已有摘要')
  assert.match(e.dialog.querySelector('.error').textContent, /需要网关密钥/)
  const summary = '😀'.repeat(10001) + '。'
  e.form.elements.summary.value = summary + ' \n'
  e.input(e.form.elements.summary)
  assert.equal(e.dialog.querySelector('.summary-count').textContent, '10002 字（不计空白，标点计入）')
  assert.equal(e.form.elements.summary.validity.valid, true)
  assert.equal(e.form.elements.summary.hasAttribute('maxlength'), false)
  await e.form.onsubmit({ preventDefault() {} })
  assert.equal(saved.summary, summary)
  assert.equal(e.dialog.open, false)
})

test('AI 生成长摘要回填完整，空白摘要仍不能保存', async t => {
  const summary = '一段完整剧情。'.repeat(1500)
  let saved
  const e = setup(t, async () => ({ summary }), async (_project, input) => { saved = input })
  await e.generate.onclick()
  assert.equal(e.form.elements.summary.value, summary)
  assert.equal(e.form.elements.summary.validity.valid, true)
  e.form.elements.summary.value = ' \n\t'
  e.input(e.form.elements.summary)
  await e.form.onsubmit({ preventDefault() {} })
  assert.equal(saved, undefined)
  assert.match(e.dialog.querySelector('.error').textContent, /摘要不能为空/)
  assert.equal(e.dialog.open, true)
})
