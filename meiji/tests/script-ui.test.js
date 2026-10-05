import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderScriptView } from '../client/script-view.js'
import { episodeDialog, renderOverview, premiseDialog } from '../client/project-overview-view.js'
import { node } from '../shared/drama-model.js'

function dom(t) {
  const env = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const old = { document: globalThis.document, window: globalThis.window, FormData: globalThis.FormData }
  Object.assign(globalThis, { document: env.window.document, window: env.window, FormData: env.window.FormData })
  env.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  env.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new env.window.Event('close')) }
  t.after(() => { Object.assign(globalThis, old); env.window.close() })
  return document.querySelector('main')
}
const project = () => ({ id: 'p', title: '来信', script: '原剧本', scriptKind: 'imported', scriptRevision: 1, scriptSource: 'import', scriptSections: { sections: [], future: '' }, scriptProposals: [], scriptPendingDeletes: [], summary: node('summary', '项目摘要'), episodes: [] })
const button = (root, text) => [...root.querySelectorAll('button')].find(item => item.textContent === text)

test('导入剧本项目隐藏创作方向，保留剧本与摘要意见入口', async t => {
  const root = dom(t), p = project(), calls = []
  const view = renderOverview(p, { perform: async (...args) => calls.push(args), openPremise: () => calls.push('premise'), openScript: () => calls.push('script'), fail: error => { throw error } }, {})
  root.append(view)
  assert.deepEqual([...view.querySelectorAll('h3')].map(item => item.textContent), ['项目摘要', '剧本', '角色库', '场景库', '道具库', '剧集'])
  assert.match(view.textContent, /待更新/)
  assert.equal(button(view, '编辑创作方向'), undefined); button(view, '查看与编辑剧本').click()
  view.querySelector('[aria-label="项目摘要修改意见"]').value = '补充结局'
  await button(view, '按意见重新生成').onclick()
  assert.equal(calls[0], 'script')
  assert.deepEqual(calls[1].slice(1), ['project-summary', { review: '补充结局' }])
})

test('剧本正文保存必填说明，旧方案不可确认，任意版本对比及占用门禁', async t => {
  const root = dom(t), p = project(), calls = []
  const versions = [1, 2].map(revision => ({ revision, content: '版本' + revision, stats: { added: 2, removed: 0 }, episodeId: 'deleted-episode', source: 'edit', note: '说明' }))
  const proposal = { id: 'old', source: 'ai-edit', status: 'pending', baseRevision: 0, changes: [{ target: { kind: 'body' }, before: '原', after: '新' }] }
  const view = renderScriptView(p, { back() {}, load: async () => ({ project: p, versions, proposals: [proposal] }), perform: async (...args) => calls.push(args) })
  root.append(view); await view.refresh()
  assert.match(view.textContent, /已删除剧集 deleted-episode/)
  const form = view.querySelector('.script-editor')
  await form.onsubmit({ preventDefault() {} }); assert.equal(calls.length, 0)
  form.querySelector('[aria-label="修改说明"]').value = '补充细节'
  form.querySelector('textarea').value = '修改剧本'
  await form.onsubmit({ preventDefault() {} })
  assert.deepEqual(calls[0].slice(1), ['script-edit', { baseRevision: 1, note: '补充细节', text: '修改剧本' }])
  assert.equal(button(view, '写入选中项').disabled, true)
  view.querySelector('[aria-label="对比旧版本"]').value = '1'
  view.querySelector('[aria-label="对比新版本"]').value = '2'
  button(view, '对比所选版本').click(); assert.match(view.textContent, /版本1/); assert.match(view.textContent, /版本2/)
  p.projectBusy = true; await view.refresh()
  assert.equal(button(view, '保存为新版本').disabled, true)
  assert.equal(button(view, '对比所选版本').disabled, false)
})

test('首集故事设想必填但不保存为创作方向，草稿携带本次要求', async t => {
  const root = dom(t), p = { ...project(), script: '', scriptKind: 'assembled' }, calls = []
  const open = episodeDialog(root, async (...args) => calls.push(args), async (...args) => { calls.push(args); return { summary: '新剧情' } })
  open(p, null)
  const dialog = root.querySelector('dialog'), form = dialog.querySelector('form')
  assert.equal(form.elements.requirements.required, true); assert.equal(form.elements.savePremise, undefined)
  form.elements.requirements.value = '旧信引出往事'
  await button(dialog, 'AI 生成').onclick()
  assert.equal(calls[0][1].requirements, '旧信引出往事')
  await form.onsubmit({ preventDefault() {} })
  assert.equal(calls[1][1].savePremise, undefined); assert.equal(dialog.open, false)
})

test('父保存成功后显示独立回写方案，先保留关闭而不重新保存', async t => {
  const root = dom(t), p = project(); let saves = 0
  const open = episodeDialog(root, async () => { saves++; return { result: { episodeId: 'e', scriptSyncOperationId: 'sync' } } }, async () => {}, {
    observeSync: async (current, id, update) => { assert.equal(id, 'sync'); update({ status: 'running' }); return { status: 'completed', result: { pendingProposal: 'proposal' } } }, openScript() {},
  })
  open(p, { id: 'e', durationSeconds: 10, summary: node('summary', '本集剧情') })
  const dialog = root.querySelector('dialog')
  await dialog.querySelector('form').onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, true); assert.match(dialog.textContent, /尚未完成同步/)
  assert.ok(button(dialog, '按方案修改剧本')); button(dialog, '先保留').click()
  assert.equal(dialog.open, false); assert.equal(saves, 1)
})

test('无导入剧本的方向入口在自动回写后仍展示，编辑保存原有方向', async t => {
  const root = dom(t), calls = [], p = { ...project(), scriptKind: 'assembled', premise: '长期寻找失踪家人', script: '首集已回写剧情' }
  const open = premiseDialog(root, async (current, text) => calls.push([current.id, text]))
  const view = renderOverview(p, { openPremise: open }, {})
  root.append(view)
  assert.equal(view.querySelector('h3').textContent, 'AI 创作方向')
  assert.match(view.textContent, /持续指导每一集摘要/)
  button(view, '编辑创作方向').click()
  const text = root.querySelector('[aria-label="AI 创作方向"]')
  assert.equal(text.value, p.premise)
  text.value = '寻找家人并揭开旧案'
  await text.form.onsubmit({ preventDefault() {} })
  assert.deepEqual(calls, [[p.id, '寻找家人并揭开旧案']])
  const first = renderOverview({ ...p, script: '' }, {}, {})
  assert.equal(first.querySelector('h3').textContent, 'AI 创作方向')
})


test('后台刷新保留尚未保存的正文和说明，新版本到来禁止按旧依据保存', async t => {
  const root = dom(t), p = project()
  const view = renderScriptView(p, { back() {}, load: async () => ({ project: structuredClone(p), versions: [], proposals: [] }), perform: async () => { throw new Error('保存失败') } })
  root.append(view); await view.refresh()
  const text = view.querySelector('[aria-label="剧本正文"]'), note = view.querySelector('[aria-label="修改说明"]')
  text.value = '未保存的新内容'; note.value = '未保存说明'; text.dispatchEvent(new window.Event('input', { bubbles: true }))
  await view.refresh()
  assert.equal(view.querySelector('[aria-label="剧本正文"]'), text); assert.equal(note.value, '未保存说明')
  await view.querySelector('.script-editor').onsubmit({ preventDefault() {} })
  assert.equal(text.value, '未保存的新内容'); assert.match(view.textContent, /保存失败/)
  p.scriptRevision = 2; await view.refresh()
  assert.equal(text.value, '未保存的新内容'); assert.equal(button(view, '保存为新版本').disabled, true)
})
