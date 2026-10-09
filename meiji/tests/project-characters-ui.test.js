import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderOverview } from '../client/project-overview-view.js'
import { libraryEditor } from '../client/project-library-view.js'
import { node } from '../shared/drama-model.js'
import { goalRequest } from '../client/goal-request.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<body><div class="meiji-panel"></div></body>')
  const prior = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, fetch: async () => ({ ok: true, json: async () => ({ assets: [] }) }) })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  return { dom, project: { id: 'p', title: '测试', mode: 'script', script: '完整剧本', episodes: [], summary: node('summary'), library: { characters: [] }, scriptProposals: [] } }
}
const button = (page, text) => [...page.querySelectorAll('button')].find(item => item.textContent === text)

test('角色库旁提取入口、点击防重、失败恢复，空剧本禁用，自由模式隐藏', async t => {
  const { project } = setup(t), response = Promise.withResolvers(), calls = [], failures = []
  const page = renderOverview(project, { perform: async (p, action) => { calls.push(goalRequest(action)); await response.promise; throw new Error('提取失败') }, fail: error => failures.push(error.message) }, {})
  const extract = button(page, '提取剧本重要角色')
  assert.equal(extract.parentElement.className, 'library-tabs')
  extract.click(); extract.click(); assert.equal(calls.length, 1); assert.equal(extract.disabled, true)
  response.resolve(); await settle(); assert.equal(extract.disabled, false); assert.deepEqual(failures, ['提取失败'])
  assert.equal(calls[0].goal.to, 'project-characters')
  assert.equal(button(renderOverview({ ...project, script: '' }, {}, {}), '提取剧本重要角色').disabled, true)
  assert.equal(button(renderOverview({ ...project, mode: 'free' }, {}, {}), '提取剧本重要角色'), undefined)
})

test('项目详情直接添加角色和多套服装，保存失败保留输入，成功刷新', async t => {
  const { project, dom } = setup(t), calls = []; let refreshed = 0
  const page = renderOverview(project, { perform: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('保存失败') }, refresh: () => refreshed++ }, {})
  document.querySelector('.meiji-panel').append(page)
  button(page, '＋ 添加角色').click()
  const dialog = page.querySelector('dialog'); dialog.querySelector('[aria-label="名称"]').value = '林医生'
  button(dialog, '＋ 添加服装').click()
  dialog.querySelector('[aria-label="服装名称"]').value = '白大褂'
  dialog.querySelector('[aria-label="服装描述"]').value = '白色长袖大褂'
  dialog.querySelector('[aria-label="适用场景"]').value = '医院'
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle()
  assert.match(dialog.textContent, /保存失败/)
  assert.equal(dialog.querySelector('[aria-label="服装名称"]').value, '白大褂')
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle()
  assert.equal(calls[1][1], 'entry-create'); assert.equal(refreshed, 1)
  assert.deepEqual(calls[1][2].fields.costumes, [{ id: '', name: '白大褂', description: '白色长袖大褂', context: '医院' }])
})

test('编辑已有服装保留固定 ID，移除与新加互不串位', async t => {
  const { project, dom } = setup(t), calls = []
  const dialog = libraryEditor(project, 'characters', { perform: async (...args) => calls.push(args) }, { entry: { id: 'R01', aliases: [] }, variant: { id: 'R01-1', fields: { costumes: [{ id: 'outfit-a', name: '雨衣', description: '黄色雨衣', context: '' }] } } })
  document.body.append(dialog)
  dialog.querySelector('[aria-label="服装描述"]').value = '蓝色雨衣'
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle()
  assert.equal(calls[0][2].fields.costumes[0].id, 'outfit-a')
})

test('项目提取接受后打开完整执行步骤，取消不跳转', async t => {
  const { project } = setup(t)
  for (const result of [{ accepted: true, runId: 'project-run' }, { cancelled: true }]) {
    const opened = [], calls = []
    const page = renderOverview(project, {
      perform: async (...args) => { calls.push(args); return result },
      openRun: (...args) => opened.push(args),
    }, {})
    button(page, '提取剧本重要角色').click()
    await settle()
    assert.deepEqual(calls, [[project, 'project-characters', { generationMode: 'regenerate' }]])
    assert.deepEqual(opened, result.accepted ? [[project, 'project-run']] : [])
  }
})
