import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOutline, outlineFailures, outlineText } from '../shared/story-outline.js'
import { outlineFixture } from './fixtures/story-package.js'
import { setupModel } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { storyDialog } from '../client/project-session-view.js'
import { JSDOM } from './fixtures/jsdom.js'

test('编号故事小段数组保留引号、换行与英文正文，展示标题不进入数据', () => {
  const outline = outlineFixture('A note says "see you".\nKeep the \\ mark.')
  assert.ok(Array.isArray(normalizeOutline(outline)))
  assert.deepEqual(normalizeOutline(JSON.parse(JSON.stringify(outline))), outline)
  assert.ok(outlineText(outline).startsWith('1.（10秒）A note'))
  assert.deepEqual(normalizeOutline(outline.map(part => Object.fromEntries(Object.entries(part).reverse()))), outline)
  for (const field of ['编号', '时长秒', '正文']) {
    const missing = structuredClone(outline); delete missing[0][field]
    assert.ok(outlineFailures(missing).length)
  }
  for (const invalid of [null, '正文', [], { outline }, { ...outline, extra: '内容' }, { ...outline, 故事小段: '' }, { 故事小段: 1 }, { 故事小段: '2. 正文' }]) {
    assert.ok(outlineFailures(invalid).length)
    assert.throws(() => normalizeOutline(invalid, 400), error => error.status === 400)
  }
})

test('编辑故事小段直接提交数组，失败保留输入，成功关闭面板弹窗', async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' }), root = dom.window.document.querySelector('main')
  const names = ['document', 'window', 'FormData'], previous = Object.fromEntries(names.map(key => [key, globalThis[key]]))
  for (const key of names) globalThis[key] = dom.window[key]
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const outline = outlineFixture('保留的正文\n第二行'), project = { durationSeconds: 10, plot: { outline: { content: outline } } }, submitted = []
  const open = storyDialog(root, async (target, input) => { assert.equal(target, project); submitted.push(input); if (submitted.length === 1) throw Error('保存失败') })
  open(project)
  const form = root.querySelector('form'), dialog = root.querySelector('dialog')
  assert.equal(form.querySelectorAll('textarea').length, 1)
  assert.equal(form.querySelector('textarea').value, outline[0].正文)
  assert.equal(form.querySelector('input').value, '10')
  form.querySelector('textarea').value = '新结尾\n仍保留悬念'
  await form.onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, true);assert.match(root.querySelector('.error').textContent, /保存失败/)
  await form.onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, false);assert.equal(root.querySelector('.panel-dialog-overlay'), null)
  assert.deepEqual(submitted[1], { outline: outlineFixture('新结尾\n仍保留悬念') })
  assert.deepEqual(project.plot.outline.content, outline)
})

test('人工保存无效结构不覆盖大纲，有效数组即使审核失败也保存', async t => {
  const e = await setupModel(t), before = (await e.read()).plot.outline.content
  await assert.rejects(runOperation(e.op('outline-text', { outline: { outline: '旧格式' } }), { home: e.home }), /大纲必须为非空 JSON 数组/)
  assert.deepEqual((await e.read()).plot.outline.content, before)
  const outline = outlineFixture('修改后的第一行\n第二行')
  let reviewInput
  await runOperation(e.op('outline-text', { outline }), { home: e.home, reviewContent: async input => { reviewInput = input; return { passed: false, failures: ['尚有因果冲突'] } } })
  assert.deepEqual(JSON.parse(reviewInput.text), outline)
  assert.deepEqual((await e.read()).plot.outline.content, outline)
})

test('时长为正整数且总和在目标上下10秒内，小段不限制15秒', () => {
  const timed = n => outlineFixture('完整故事', 'zh-CN', n)
  for (const n of [290, 300, 310]) assert.deepEqual(outlineFailures(timed(n), 300), [])
  for (const n of [289, 311]) assert.match(outlineFailures(timed(n), 300)[0], /允许 290–310 秒/)
  assert.deepEqual(outlineFailures(timed(1), 1), [])
  for (const n of [0, -1, 1.5, '60', null]) {
    const value = timed(60); value[0].时长秒 = n
    assert.match(outlineFailures(value, 60)[0], /正整数/)
  }
  const value = timed(60); value[0].编号 = 2
  assert.match(outlineFailures(value)[0], /连续/)
  value[0].编号 = 1; value[0].extra = '多余字段'
  assert.match(outlineFailures(value)[0], /必须仅含/)
})

test('人工保存拒绝时长不足，已保存正文与下游不被清除', async t => {
  const e = await setupModel(t), before = await e.read()
  await assert.rejects(runOperation(e.op('outline-text', { outline: outlineFixture('错误预算', 'zh-CN', 30) }), { home: e.home }), /总时长 30 秒.*允许 1–20 秒/)
  const after = await e.read()
  assert.deepEqual(after.plot.outline.content, before.plot.outline.content)
  assert.equal(after.plot.outline.revision, before.plot.outline.revision)
  assert.deepEqual(after.shots.items, before.shots.items)
})

test('真实大纲任务按程序预算修订，语义审核通过不能放行错误时长', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => { root.episodes[0].durationSeconds = 300; return root })
  let generations = 0, repair = ''
  await runOperation(e.op('story', {}), { home: e.home, request: async message => {
    if (message.skill === 'review') return JSON.stringify({passed:true,issues:[]})
    if (message.skill === 'episode') return JSON.stringify({summary:'展示摘要'})
    generations++
    if (generations > 1) repair = message.user
    return JSON.stringify(outlineFixture('旅人完整经历本集事件。', 'zh-CN', generations === 1 ? 248 : 300))
  } })
  assert.equal(generations, 2)
  assert.match(repair, /总时长 248 秒.*允许 290–310 秒/)
  const saved = await e.read()
  assert.equal(saved.plot.outline.check.passed, true)
  assert.equal(saved.plot.outline.content[0].时长秒, 300)
})

test('小段编辑支持增删，实时总和与保存校验使用同一数组', async t => {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main')
  const prior = {document:globalThis.document,window:globalThis.window}
  Object.assign(globalThis,{document:dom.window.document,window:dom.window})
  t.after(()=>{Object.assign(globalThis,prior);dom.window.close()})
  dom.window.HTMLDialogElement.prototype.show = function(){this.open=true}
  dom.window.HTMLDialogElement.prototype.close = function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))}
  const saved=[], outline=[{编号:1,时长秒:120,正文:'前段'},{编号:2,时长秒:180,正文:'后段'}]
  storyDialog(root,async(_,input)=>saved.push(input))({durationSeconds:300,plot:{outline:{content:outline}}})
  const form=root.querySelector('form'), find=text=>[...form.querySelectorAll('button')].find(button=>button.textContent===text)
  find('＋ 添加故事小段').click()
  const added=form.querySelectorAll('fieldset')[2]
  added.querySelector('input').value='30'; added.querySelector('textarea').value='临时新增段'
  added.querySelector('input').dispatchEvent(new dom.window.Event('input',{bubbles:true}))
  assert.match(form.querySelector('.meta').textContent,/总时长：330秒/)
  await form.onsubmit({preventDefault(){}})
  assert.equal(saved.length,0); assert.match(form.querySelector('.error').textContent,/允许 290–310 秒/)
  added.querySelector('button').click()
  assert.match(form.querySelector('.meta').textContent,/总时长：300秒/)
  await form.onsubmit({preventDefault(){}})
  assert.deepEqual(saved,[{outline}])
})
