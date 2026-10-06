import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { libraryEditor, renderProjectLibrary, cardLibraryControls } from '../client/project-library-view.js'
import { createLibraryEntry } from '../shared/library-rules.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<body></body>'), keys = ['document', 'window', 'fetch'], prior = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, fetch: async () => ({ ok: true, json: async () => ({ assets: [] }) }) })
  dom.window.HTMLDialogElement.prototype.close = function() { this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  const project = { id: 'project', library: { characters: [], scenes: [], props: [] }, episodes: [] }
  return { project, dom }
}
for (const kind of ['characters', 'scenes', 'props']) test(`${kind}新建库条目字段、照片与失败输入保留`, async t => {
  const { project, dom } = setup(t), seen = []
  const dialog = libraryEditor(project, kind, { perform: async (...args) => { seen.push(args); throw new Error('保存失败') }, stage() {} })
  document.body.append(dialog)
  dialog.querySelector('[aria-label=名称]').value = '新条目'
  assert.equal(Boolean(dialog.querySelector('[aria-label=必须出场]')), kind === 'characters')
  assert.ok(dialog.querySelector('[aria-label=指定照片]')); assert.ok(dialog.querySelector('[aria-label=从素材库选照片]'))
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle()
  assert.equal(seen[0][1], 'entry-create'); assert.equal(seen[0][2].libraryKind, kind); assert.equal(dialog.querySelector('[aria-label=名称]').value, '新条目')
  assert.match(dialog.textContent, /保存失败/); assert.equal(dialog.querySelector('[type=submit]').disabled, false)
})
test('库详情默认、照片来源、关联删除保护；卡片提供关联、改变体与解除入口', async t => {
  const { project } = setup(t), { entry, variant } = createLibraryEntry(project, 'characters', { name: '角色', nationality: '中国', required: true, image: { content: { assetId: 'photo', assetCategory: 'characters', source: 'photo' } } })
  const card = { id: 'C01', type: 'role', name: entry.name, ref: { libraryId: entry.id, variantId: variant.id } }
  project.episodes.push({ id: 'episode', plot: { characters: { items: [card] } } })
  const page = renderProjectLibrary(project, 'characters', { perform() {}, back() {} }); document.body.append(page)
  page.querySelector('.character-item').click()
  assert.match(page.textContent, /必须出场/); assert.match(page.textContent, /指定照片/); assert.match(page.textContent, /关联 1 集/)
  assert.equal([...page.querySelectorAll('button')].find(button => button.textContent === '删除条目').disabled, true)
  const controls = cardLibraryControls(project, card, {})
  assert.match(controls.textContent, /复用库图/); assert.match(controls.textContent, /解除关联/); assert.doesNotMatch(controls.textContent, /新增造型|改变体/)
})
