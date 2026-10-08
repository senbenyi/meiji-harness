import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { libraryEditor, renderProjectLibrary, cardLibraryControls } from '../client/project-library-view.js'
import { createLibraryEntry } from '../shared/library-rules.js'
import { goalRequest } from '../client/goal-request.js'
import { planRun } from '../shared/run-planner.js'
const settle = () => new Promise(resolve => setImmediate(resolve))

test('项目库已有图片的重新生成按钮规划实际生图步骤', async t => {
 const { project } = setup(t), calls = []
 const { entry } = createLibraryEntry(project, 'characters', { name: '角色', image: { content: { assetId: 'existing', assetCategory: 'characters' } } })
 const page = renderProjectLibrary(project, 'characters', { perform: async (_project, action, fields) => { calls.push(goalRequest(action, fields).goal); return { cancelled: true } } }, { entryId: entry.id })
 page.querySelector('[aria-label="重新生成角色图片：角色"]').click(); await settle()
 assert.equal(calls[0].mode, 'regenerate')
 assert.notEqual(planRun(project, calls[0]).steps.find(step => step.kind === 'image').status, 'skipped')
})
function setup(t) {
  const dom = new JSDOM('<body></body>'), keys = ['document', 'window', 'fetch'], prior = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, fetch: async () => ({ ok: true, json: async () => ({ assets: [] }) }) })
  dom.window.HTMLDialogElement.prototype.show = function() { this.open = true }
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
test('库详情默认、照片来源、关联角色删除入口；卡片提供关联与解除入口', async t => {
  const { project } = setup(t), { entry, variant } = createLibraryEntry(project, 'characters', { name: '角色', nationality: '中国', required: true, image: { content: { assetId: 'photo', assetCategory: 'characters', source: 'photo' } } })
  const card = { id: 'C01', type: 'role', name: entry.name, ref: { libraryId: entry.id, variantId: variant.id } }
  project.episodes.push({ id: 'episode', plot: { characters: { items: [card] } } })
  const page = renderProjectLibrary(project, 'characters', { perform() {}, back() {} }); document.body.append(page)
  page.querySelector('.character-item').click()
  assert.match(page.textContent, /必须出场/); assert.match(page.textContent, /指定照片/); assert.match(page.textContent, /关联 1 集/)
  assert.equal([...page.querySelectorAll('button')].find(button => button.textContent === '删除角色').disabled, false)
  const controls = cardLibraryControls(project, card, {})
  assert.match(controls.textContent, /复用库图/); assert.match(controls.textContent, /解除关联/); assert.doesNotMatch(controls.textContent, /新增造型|改变体/)
})

test('项目详情点击角色或场景直达详情，并提供编辑、重新生成和素材库导入', async t => {
  const { project } = setup(t), { entry } = createLibraryEntry(project, 'scenes', { name: '庭院', landmark: '老宅' })
  const page = renderProjectLibrary(project, 'scenes', { perform() {}, back() {} }, { entryId: entry.id }); document.body.append(page)
  assert.match(page.querySelector('h2').textContent, /场景详情/)
  assert.equal(page.querySelectorAll('.character-item').length, 0)
  assert.ok([...page.querySelectorAll('button')].some(button => button.textContent === '编辑资料'))
  assert.ok([...page.querySelectorAll('button')].some(button => button.textContent === '重新生成'))
  const importButton = [...page.querySelectorAll('button')].find(button => button.textContent === '从素材库导入')
  assert.ok(importButton)
  importButton.click()
  assert.ok(page.querySelector('dialog [aria-label="从素材库选照片"]'))
})
