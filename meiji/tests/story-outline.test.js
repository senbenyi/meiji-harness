import test from 'node:test'
import assert from 'node:assert/strict'
import { outlineFields, normalizeOutline, outlineFailures, outlineText } from '../shared/story-outline.js'
import { outlineFixture } from './fixtures/story-package.js'
import { setupModel } from './fixtures/model.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { storyDialog } from '../client/project-session-view.js'
import { JSDOM } from './fixtures/jsdom.js'

test('七字段对象保留引号、换行与英文正文，展示标题不进入数据', () => {
  const outline = outlineFixture('A note says "see you".\nKeep the \\ mark.')
  assert.deepEqual(Object.keys(normalizeOutline(outline)), outlineFields)
  assert.deepEqual(normalizeOutline(JSON.parse(JSON.stringify(outline))), outline)
  assert.ok(outlineText(outline).startsWith('【主角动机】\nA note'))
  assert.deepEqual(normalizeOutline(Object.fromEntries(Object.entries(outline).reverse())), outline)
  for (const field of outlineFields) {
    const missing = { ...outline };delete missing[field]
    assert.ok(outlineFailures(missing).length)
  }
  for (const invalid of [null, '正文', [], { outline }, { ...outline, extra: '内容' }, { ...outline, 因果剧情: '' }, { ...outline, 世界规则: 1 }, { ...outline, 主角动机: '【主角动机】\n正文' }]) {
    assert.ok(outlineFailures(invalid).length)
    assert.throws(() => normalizeOutline(invalid, 400), error => error.status === 400)
  }
})

test('编辑七个字段仅提交对象，失败保留输入，成功关闭面板弹窗', async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' }), root = dom.window.document.querySelector('main')
  const names = ['document', 'window', 'FormData'], previous = Object.fromEntries(names.map(key => [key, globalThis[key]]))
  for (const key of names) globalThis[key] = dom.window[key]
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const outline = outlineFixture('保留的正文\n第二行'), project = { plot: { outline: { content: outline } } }, submitted = []
  const open = storyDialog(root, async (target, input) => { assert.equal(target, project); submitted.push(input); if (submitted.length === 1) throw Error('保存失败') })
  open(project)
  const form = root.querySelector('form'), dialog = root.querySelector('dialog')
  assert.equal(form.querySelectorAll('textarea').length, 7)
  for (const field of outlineFields) assert.equal(form.elements.namedItem(field).value, outline[field])
  form.elements.namedItem('结尾关键画面').value = '新结尾\n仍保留悬念'
  await form.onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, true);assert.match(root.querySelector('.error').textContent, /保存失败/)
  await form.onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, false);assert.equal(root.querySelector('.panel-dialog-overlay'), null)
  assert.deepEqual(submitted[1], { outline: { ...outline, 结尾关键画面: '新结尾\n仍保留悬念' } })
  assert.deepEqual(project.plot.outline.content, outline)
})

test('人工保存无效对象不覆盖大纲，有效对象即使审核失败也保存', async t => {
  const e = await setupModel(t), before = (await e.read()).plot.outline.content
  await assert.rejects(runOperation(e.op('outline-text', { outline: { outline: '旧格式' } }), { home: e.home }), /七个|大纲字段/)
  assert.deepEqual((await e.read()).plot.outline.content, before)
  const outline = { ...before, 因果剧情: '修改后的第一行\n第二行' }
  let reviewInput
  await runOperation(e.op('outline-text', { outline }), { home: e.home, reviewContent: async input => { reviewInput = input; return { passed: false, failures: ['尚有因果冲突'] } } })
  assert.deepEqual(JSON.parse(reviewInput.text), outline)
  assert.deepEqual((await e.read()).plot.outline.content, outline)
})
