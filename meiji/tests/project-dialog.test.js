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
  form.elements.title.value = '测试项目'; form.elements.style.value = '写实电影'; form.elements.summary.value = '项目摘要'
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

test('创建页选择剧本代替手填摘要，移除及重新打开恢复正常输入', async t => {
  let created
  const e = setup(t, async input => { created = input }, { generateSummary: async id => ({ summary: '生成的项目摘要', operationId: 'draft-id', sessionId: 'session-id', scriptAssetId: id }) })
  const assets = [{ id: 'script-id', originalName: '来信.txt' }]
  t.mock.method(globalThis, 'fetch', async url => { assert.match(url, /assets\?category=scripts/); return Response.json({ assets }) })
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  assert.equal(picker.hidden, false)
  picker.value = assets[0].id; await picker.onchange()
  assert.equal(e.form.elements.summary.readOnly, true)
  assert.equal(e.form.elements.summary.value, '生成的项目摘要')
  assert.equal(e.dialog.querySelector('label[for=project-script]').textContent, '剧本')
  await e.submit()
  assert.equal(created.scriptAssetId, assets[0].id)
  assert.equal(created.summary, undefined)
  assert.equal(created.summaryDraftOperationId, 'draft-id')
  assert.equal(e.dialog.open, false)
  e.open()
  assert.equal(e.form.elements.summary.disabled, false)
  assert.equal(e.form.elements.summary.required, true)
  assert.equal(e.dialog.querySelector('.script-clear').hidden, true)
  e.form.elements.summary.value = '手填内容'
  await e.dialog.querySelector('.script-choose').onclick()
  picker.value = assets[0].id; await picker.onchange()
  e.dialog.querySelector('.script-clear').onclick()
  assert.equal(e.form.elements.summary.value, '手填内容')
})

test('创建页直接导入TXT，上传失败保留输入且可再次上传', async t => {
  let fail = true, created
  const e = setup(t, async input => { created = input }, { generateSummary: async () => ({ summary: '导入后生成的摘要', operationId: 'draft-id', sessionId: 'session-id' }) })
  const source = { name: '来信.txt', size: 12 }, file = e.dialog.querySelector('input[type=file]')
  Object.defineProperty(file, 'files', { value: [source] })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /category=scripts/)
    assert.equal(options.body, source)
    assert.equal(options.headers['X-Meiji-Request'], '1')
    return fail ? Response.json({ error: 'UTF-8编码无效' }, { status: 400 }) : Response.json({ asset: { id: 'imported-script', originalName: '来信.txt' } })
  })
  await file.onchange()
  assert.equal(e.form.elements.summary.value, '项目摘要')
  assert.match(e.dialog.querySelector('.error').textContent, /UTF-8/)
  assert.equal(e.form.querySelector('[type=submit]').disabled, false)
  fail = false; await file.onchange(); await e.submit()
  assert.equal(created.scriptAssetId, 'imported-script')
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
  await button('重新提取摘要').onclick()
  button('查看摘要任务历史 →').click(); button('查看 skill').click()
  assert.deepEqual(calls.map(args => args[1]), ['project-summary', 'project-summary', 'project-summary'])
})

test('剧本摘要生成失败保留选择与表单，重试成功才允许创建', async t => {
  let calls = 0, created
  const e = setup(t, async input => { created = input }, { generateSummary: async () => {
    if (++calls === 1) throw new Error('摘要接口失败')
    return { summary: '重新生成的摘要', operationId: 'draft-id', sessionId: 'session-id' }
  } })
  const assets = [{ id: 'script-id', originalName: '来信.txt' }]
  t.mock.method(globalThis, 'fetch', async () => Response.json({ assets }))
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  picker.value = 'script-id'; await picker.onchange()
  assert.equal(e.form.elements.title.value, '测试项目')
  assert.equal(e.dialog.querySelector('.script-selected').textContent, '来信.txt')
  assert.equal(e.form.querySelector('[type=submit]').disabled, true)
  assert.match(e.dialog.querySelector('.error').textContent, /摘要接口失败/)
  await e.submit(); assert.equal(created, undefined)
  await e.dialog.querySelector('.script-summary-retry').onclick()
  assert.equal(e.form.elements.summary.value, '重新生成的摘要')
  assert.equal(e.form.querySelector('[type=submit]').disabled, false)
  await e.submit(); assert.equal(created.summaryDraftOperationId, 'draft-id')
})

test('换剧本、移除和关闭弹窗停止摘要生成，迟到响应不能覆盖新摘要', async t => {
  const pending = []
  const e = setup(t, async () => {}, { generateSummary: (id, options) => new Promise(resolve => pending.push({ id, ...options, resolve })) })
  const assets = [{ id: 'a', originalName: '甲.txt' }, { id: 'b', originalName: '乙.txt' }]
  t.mock.method(globalThis, 'fetch', async () => Response.json({ assets }))
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  picker.value = 'a'; const first = picker.onchange()
  assert.equal(e.form.querySelector('[type=submit]').disabled, true)
  picker.value = 'b'; const second = picker.onchange()
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve({ summary: '乙摘要', operationId: 'b-task' }); await second
  pending[0].resolve({ summary: '甲摘要', operationId: 'a-task' }); await first
  assert.equal(e.form.elements.summary.value, '乙摘要')
  e.dialog.querySelector('.script-clear').onclick()
  assert.equal(e.form.elements.summary.value, '项目摘要')
  assert.equal(e.form.elements.summary.readOnly, false)
  picker.value = 'a'; const third = picker.onchange()
  e.dialog.close()
  assert.equal(pending[2].signal.aborted, true)
  e.open(); pending[2].resolve({ summary: '迟到摘要' }); await third
  assert.equal(e.form.elements.summary.value, '')
  assert.equal(e.dialog.querySelector('.script-selected').textContent, '')
})

test('默认创建页选中剧本后调用摘要草稿任务并将结果填到摘要框', async t => {
  const e = setup(t, async () => {})
  const sessionId = 'session-33333333-3333-4333-8333-333333333333'
  document.defaultView.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url)
    if (url.includes('assets?')) return Response.json({ assets: [{ id: 'script-id', originalName: '来信.txt' }] })
    if (url.endsWith('/turn')) {
      assert.deepEqual(JSON.parse(options.body), { action: 'project-summary', draft: true, scriptAssetId: 'script-id', sessionId })
      return Response.json({ operationId: 'draft-id' })
    }
    assert.match(url, /operations\/draft-id\?sessionId=/)
    return Response.json({ operation: { id: 'draft-id', status: 'completed', draft: { summary: '已通过的摘要', scriptAssetId: 'script-id', check: { passed: true } }, tasks: [{ id: 'task-id', label: '项目摘要', status: 'completed', nodes: [], artifacts: [] }] } })
  })
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  picker.value = 'script-id'; await picker.onchange()
  assert.equal(e.form.elements.summary.value, '已通过的摘要')
  assert.equal(e.dialog.querySelector('.script-summary-task').hidden, false)
  assert.equal(e.form.querySelector('[type=submit]').disabled, false)
  assert.equal(calls.length, 3)
})

test('摘要草稿启动响应迟到时，移除剧本后仍会取消后台任务', async t => {
  const e = setup(t, async () => {})
  const sessionId = 'session-33333333-3333-4333-8333-333333333333'
  document.defaultView.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  let resolve, cancel
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('assets?')) return Response.json({ assets: [{ id: 'script-id', originalName: '来信.txt' }] })
    if (url.endsWith('/turn')) return new Promise(done => { resolve = () => done(Response.json({ operationId: 'late-task' })) })
    assert.match(url, /operations\/cancel$/)
    cancel = JSON.parse(options.body)
    return Response.json({ accepted: true })
  })
  await e.dialog.querySelector('.script-choose').onclick()
  const picker = e.dialog.querySelector('.script-picker')
  picker.value = 'script-id'; const pending = picker.onchange()
  e.dialog.querySelector('.script-clear').onclick()
  resolve(); await pending
  assert.deepEqual(cancel, { sessionId, operationId: 'late-task' })
  assert.equal(e.form.elements.summary.value, '项目摘要')
})
