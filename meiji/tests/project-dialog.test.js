import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { projectDialog } from '../client/project-session-view.js'
import { renderOverview } from '../client/project-overview-view.js'
import { renderLibrary } from '../client/asset-library-view.js'
import { node } from '../shared/drama-model.js'

function setup(t, create, options) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/' })
  const previous = { document: globalThis.document, FormData: globalThis.FormData }
  Object.assign(globalThis, { document: dom.window.document, FormData: dom.window.FormData })
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  const root = dom.window.document.querySelector('main'), open = projectDialog(root, create, options)
  open()
  const dialog = root.querySelector('dialog'), form = dialog.querySelector('form')
  form.elements.title.value = '测试项目'; form.elements.style.value = '写实电影'
  return { root, dialog, form, open, submit: () => form.onsubmit({ preventDefault() {} }) }
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

test('创建页选择剧本保留文件名，不发起模型任务；移除和重开清除选择', async t => {
  let created
  const e = setup(t, async input => { created = input })
  assert.equal(e.form.elements.summary, undefined)
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return Response.json({ assets: [{ id: 'script-id', originalName: '来信.txt' }] }) })
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  picker.value = 'script-id'; await picker.onchange()
  assert.equal(e.dialog.querySelector('.script-selected').textContent, '来信.txt')
  await e.submit()
  assert.equal(created.scriptAssetId, 'script-id'); assert.equal(created.summary, undefined)
  assert.equal(calls.length, 1)
  e.open(); assert.equal(e.dialog.querySelector('.script-selected').textContent, '')
  await e.dialog.querySelector('.script-choose').onclick()
  picker.value = 'script-id'; await picker.onchange()
  e.dialog.querySelector('.script-clear').onclick(); await e.submit()
  assert.equal(created.scriptAssetId, undefined)
})

test('导入失败保留表单且可重试', async t => {
  let fail = true, created
  const e = setup(t, async input => { created = input })
  const source = { name: '来信.txt', size: 12 }, file = e.dialog.querySelector('input[type=file]')
  Object.defineProperty(file, 'files', { value: [source] })
  t.mock.method(globalThis, 'fetch', async () => fail ? Response.json({ error: 'UTF-8编码无效' }, { status: 400 }) : Response.json({ asset: { id: 'imported', originalName: '来信.txt' } }))
  await file.onchange(); assert.match(e.dialog.querySelector('.error').textContent, /UTF-8/)
  assert.equal(e.form.elements.title.value, '测试项目')
  fail = false; await file.onchange(); await e.submit()
  assert.equal(created.scriptAssetId, 'imported')
})

test('关闭创建页后迟到的素材列表不能覆盖新表单', async t => {
  const e = setup(t, async () => {}); let resolve
  t.mock.method(globalThis, 'fetch', () => new Promise(done => { resolve = done }))
  const pending = e.dialog.querySelector('.script-choose').onclick()
  e.dialog.close(); e.open()
  resolve(Response.json({ assets: [{ id: 'old', originalName: '旧.txt' }] })); await pending
  assert.equal(e.dialog.querySelector('.script-picker').hidden, true)
  assert.equal(e.dialog.querySelector('.script-selected').textContent, '')
})

test('剧本素材可按需预览和下载，正文使用纯文本避免执行HTML', async t => {
  const e = setup(t, async () => {})
  const asset = { id: 'script-id', category: 'scripts', originalName: '来信.txt', size: 100, createdAt: new Date().toISOString() }
  let reads = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('asset-file')) { reads++; return new Response('<script>不会执行</script>\n剧情正文') }
    return Response.json(url.endsWith('projects') ? { projects: [] } : { assets: url.includes('category=scripts') ? [asset] : [] })
  })
  const view = renderLibrary(() => {}, {})
  e.root.append(view)
  const scripts = [...view.querySelectorAll('button')].find(button => button.textContent === '剧本')
  scripts.click(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 0)
  const detail = view.querySelector('.guidance-preview')
  detail.open = true; await detail.ontoggle()
  assert.match(detail.querySelector('pre').textContent, /<script>不会执行<\/script>/)
  assert.equal(detail.querySelector('script'), null)
  assert.match(view.querySelector('a[download]').href, /category=scripts.*download=1/)
})

test('项目摘要失败仅展示一次，概要提供提取、任务历史及skill入口', async t => {
  const e = setup(t, async () => {}), summary = node('summary', '失败稿')
  summary.check = { passed: false, failures: ['遗漏结局'] }
  const project = { id: 'project-id', title: '来信', script: '完整剧本', summary, episodes: [] }
  const calls = []
  const view = renderOverview(project, { perform: async (...args) => calls.push(args), openHistory: (...args) => calls.push(args), openSkill: (...args) => calls.push(args), fail: error => { throw error } }, {})
  e.root.append(view)
  assert.equal(view.textContent.split('遗漏结局').length - 1, 1)
  const button = text => [...view.querySelectorAll('button')].find(button => button.textContent === text)
  await button('立即更新摘要').onclick()
  button('查看摘要任务历史 →').click(); button('查看 skill').click()
  assert.deepEqual(calls.map(args => args[1]), ['project-summary', 'project-summary', 'project-summary'])
})
