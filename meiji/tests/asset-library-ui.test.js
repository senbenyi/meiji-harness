import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { categories, renderLibrary } from '../client/asset-library-view.js'
import { createBridge } from '../client/chat-bridge.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t, remove) {
  const dom = new JSDOM('<body></body>'), keys = ['document', 'window', 'fetch']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]])), deleted = new Set(), calls = []
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, fetch: async url => {
    const category = new URL(url, 'http://localhost').searchParams.get('category')
    const asset = { id: category, category, originalName: category + '.素材', mime: category === 'audio' ? 'audio/mpeg' : category === 'video' ? 'video/mp4' : 'image/png', size: 12, createdAt: '2026-10-05', content: '文本', guidanceType: 'expression' }
    return { ok: true, json: async () => ({ projects: [], assets: deleted.has(category) ? [] : [asset] }) }
  } })
  dom.window.confirm = () => true
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  const page = renderLibrary(() => {}, { deleteLibrary: async asset => { calls.push(asset); await remove?.(asset); deleted.add(asset.category) } })
  document.body.append(page)
  const button = label => [...page.querySelectorAll('button')].find(item => item.textContent === label)
  button('素材').click()
  return { page, button, calls }
}
test('七类卡片均可取消或确认删除，成功刷新为空列表', async t => {
  const { page, button, calls } = setup(t)
  for (const [category, label] of categories) {
    button(label).click(); await settle()
    const remove = page.querySelector('.asset-card button')
    assert.equal(remove.textContent, '删除')
    assert.equal(remove.getAttribute('aria-label'), `删除素材 ${category}.素材`)
    window.confirm = message => { assert.match(message, /已有引用和原文件会保留/); return false }
    const count = calls.length; remove.click(); await settle(); assert.equal(calls.length, count)
    window.confirm = () => true; remove.click(); await settle()
    assert.equal(calls.at(-1).category, category)
    assert.equal(page.querySelectorAll('.asset-card').length, 0)
    assert.match(page.textContent, /暂无素材/)
  }
})
test('删除过程中防止重复点击，失败保留卡片并可重试', async t => {
  let reject
  const { page, calls } = setup(t, () => new Promise((_, fail) => { reject = fail }))
  await settle()
  const remove = page.querySelector('.asset-card button')
  remove.click(); remove.click()
  assert.equal(calls.length, 1); assert.equal(remove.disabled, true)
  reject(new Error('删除失败')); await settle()
  assert.match(page.textContent, /删除失败/); assert.equal(remove.disabled, false)
  assert.equal(page.querySelectorAll('.asset-card').length, 1)
  remove.click(); assert.equal(calls.length, 2); reject(new Error('再次失败')); await settle()
})
test('删除完成时已切换分类，不覆盖当前分类内容', async t => {
  let finish
  const { page, button } = setup(t, () => new Promise(resolve => { finish = resolve }))
  await settle(); page.querySelector('.asset-card button').click()
  button('场景').click(); await settle(); finish(); await settle()
  assert.equal(page.querySelector('.asset-card strong').textContent, 'scenes.素材')
  button('人物').click(); await settle(); assert.equal(page.querySelectorAll('.asset-card').length, 0)
})
test('删除期间切换分类再返回，完成后刷新移除卡片', async t => {
  let finish
  const { page, button } = setup(t, () => new Promise(resolve => { finish = resolve }))
  await settle(); page.querySelector('.asset-card button').click()
  button('场景').click(); await settle(); button('人物').click(); await settle()
  finish(); await settle(); assert.equal(page.querySelectorAll('.asset-card').length, 0)
})
test('素材导入和删除不依赖项目列表，保留会话与同源请求参数', async t => {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' }), previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  const sessionId = 'session-11111111-1111-4111-8111-111111111111'
  dom.window.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  const calls = [], bridge = createBridge({ request: async (path, options) => {
    assert.equal(path, 'turn', '素材操作不应预先读取项目列表')
    calls.push(JSON.parse(options.body)); return { completed: true }
  }, jsonBody: value => ({ body: JSON.stringify(value) }), status() {} })
  for (const action of ['library-import', 'library-delete']) {
    await bridge.perform(null, action, { category: 'props', assetId: 'asset' })
    assert.deepEqual(calls.at(-1), { sessionId, action, category: 'props', assetId: 'asset' })
  }
})
