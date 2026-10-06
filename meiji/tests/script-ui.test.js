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
const project = () => ({ mode: 'script', id: 'p', title: '来信', script: '原剧本', scriptName: '02-黄蓉身陷江湖劫绿影重重谁知真.txt', scriptKind: 'imported', scriptRevision: 1, scriptSource: 'import', scriptSections: { sections: [], future: '' }, scriptProposals: [], scriptPendingDeletes: [], summary: node('summary', '项目摘要'), episodes: [] })
const button = (root, text) => [...root.querySelectorAll('button')].find(item => item.textContent === text)

test('导入剧本项目隐藏创作方向，摘要只读并保留剧本入口', async t => {
  const root = dom(t), p = project(), calls = []
  const view = renderOverview(p, { perform: async (...args) => calls.push(args), openPremise: () => calls.push('premise'), openScript: () => calls.push('script'), fail: error => { throw error } }, {})
  root.append(view)
  assert.deepEqual([...view.querySelectorAll('h3')].map(item => item.textContent), ['项目摘要', '剧本', '剧集'])
  assert.deepEqual([...view.querySelectorAll('.library-tab')].map(item => item.textContent), ['角色库', '场景库', '道具库'])
  assert.equal(view.querySelector('.library-tab[aria-selected="true"]').textContent, '角色库')
  view.querySelectorAll('.library-tab')[1].click()
  assert.equal(view.querySelector('.library-tab[aria-selected="true"]').textContent, '场景库')
  assert.equal(view.querySelectorAll('.library-tab-panel')[0].hidden, true)
  assert.equal(view.querySelectorAll('.library-empty').length, 3)
  assert.equal([...view.querySelectorAll('button')].some(item => /查看与管理/.test(item.textContent)), false)
  assert.match(view.querySelector('.library-empty').textContent, /根据剧集自动生成角色、场景和道具/)
  assert.match(view.querySelector('.episode-placeholder').textContent, /还没有剧集/)
  assert.equal(button(view, '编辑创作方向'), undefined)
  assert.equal([...view.querySelectorAll('button')].some(item => /更新摘要|重新生成|摘要任务历史|查看 skill/.test(item.textContent)), false)
  assert.match(view.querySelector('.script-file-name').textContent, /02-黄蓉身陷江湖劫绿影重重谁知真\.txt/)
  assert.equal(button(view, '查看全部详情'), undefined)
  assert.equal(button(view, '修改后续剧情'), undefined)
  view.querySelector('[aria-label="查看剧本：02-黄蓉身陷江湖劫绿影重重谁知真.txt"]').click()
  assert.equal(calls[0], 'script')
  view.querySelector('[aria-label="打开剧本详情"]').click()
  assert.equal(calls[1], 'script')
})

test('角色场景道具以横向卡片展示并直达条目详情', async t => {
  const root = dom(t), calls = [], p = { ...project(), library: {
    characters: [{ id: 'c1', name: '黄蓉', aliases: [], variants: [{ id: 'cv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'cv1' }],
    scenes: [{ id: 's1', name: '桃花岛', aliases: [], variants: [{ id: 'sv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'sv1' }],
    props: [{ id: 'p1', name: '玉箫', aliases: [], variants: [{ id: 'pv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'pv1' }],
  } }
  const view = renderOverview(p, { openLibraryEntry: (...args) => calls.push(args) }, {})
  root.append(view)
  assert.equal(view.querySelectorAll('.library-card').length, 3)
  assert.equal(view.querySelectorAll('.library-tab-panel .characters-strip').length, 3)
  view.querySelector('[aria-label="角色库详情：黄蓉"]').click()
  assert.deepEqual(calls[0], [p, 'characters', 'c1'])
  view.querySelectorAll('.library-tab')[1].click()
  view.querySelector('[aria-label="场景库详情：桃花岛"]').click()
  assert.deepEqual(calls[1], [p, 'scenes', 's1'])
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
  p.executionLocks = [{ scope: 'project', target: 'script' }]; await view.refresh()
  assert.equal(button(view, '保存为新版本').disabled, true)
  assert.equal(button(view, '对比所选版本').disabled, false)
})

test('自由模式本集要求选填且不改方向，草稿携带本次要求', async t => {
  const root = dom(t), p = { ...project(), mode: 'free', premise: '人的创作方向', script: '', scriptKind: 'assembled' }, calls = []
  const open = episodeDialog(root, async (...args) => calls.push(args), async (...args) => { calls.push(args); return { summary: '新剧情' } })
  open(p, null)
  const dialog = root.querySelector('dialog'), form = dialog.querySelector('form')
  assert.equal(form.elements.requirements.required, false); assert.equal(form.elements.savePremise, undefined)
  form.elements.requirements.value = '旧信引出往事'
  await button(dialog, 'AI 生成').onclick()
  assert.equal(calls[0][1].requirements, '旧信引出往事')
  await form.onsubmit({ preventDefault() {} })
  assert.equal(calls[1][1].savePremise, undefined); assert.equal(dialog.open, false)
})

test('父保存成功后显示独立回写方案，先保留关闭而不重新保存', async t => {
  const root = dom(t), p = project(); let saves = 0
  const open = episodeDialog(root, async () => { saves++; return { syncRunId: 'sync', result: { episodeId: 'e' } } }, async () => {}, {
    observeSync: async (current, id, update) => { assert.equal(id, 'sync'); update({ status: 'running' }); return { status: 'paused', pause: { reasons: [{ code: 'wait_script_confirm' }] } } }, openScript() {},
  })
  open(p, { id: 'e', durationSeconds: 10, summary: node('summary', '本集剧情') })
  const dialog = root.querySelector('dialog')
  await dialog.querySelector('form').onsubmit({ preventDefault() {} })
  assert.equal(dialog.open, true); assert.match(dialog.textContent, /尚未完成同步/)
  assert.ok(button(dialog, '按方案修改剧本')); button(dialog, '先保留').click()
  assert.equal(dialog.open, false); assert.equal(saves, 1)
})

test('无导入剧本的方向入口在自动回写后仍展示，编辑保存原有方向', async t => {
  const root = dom(t), calls = [], p = { ...project(), mode: 'free', scriptKind: 'assembled', premise: '长期寻找失踪家人', script: '首集已回写剧情' }
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


test('保存后的强制刷新被后台响应接续时仍显示新版本并解除旧版本警告', async t => {
  const root = dom(t), p = project(), pending = []
  let defer = false
  const result = () => ({ project: structuredClone(p), versions: [], proposals: [] })
  const view = renderScriptView(p, { back() {}, load: () => defer ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(result()), perform: async () => {} })
  root.append(view); await view.refresh()
  const input = view.querySelector('[aria-label="剧本正文"]')
  input.value = '已保存新正文'; input.dispatchEvent(new window.Event('input', { bubbles: true }))
  p.scriptRevision = 2; p.script = '已保存新正文'
  await view.refresh()
  assert.equal(button(view, '保存为新版本').disabled, true)
  defer = true
  const saved = view.refresh(true), background = view.refresh()
  pending[0](result()); await saved
  pending[1](result()); await background
  assert.equal(view.querySelector('[aria-label="剧本正文"]').value, p.script)
  assert.match(view.textContent, /V2/)
  assert.doesNotMatch(view.textContent, /未保存的输入已保留/)
  assert.equal(button(view, '保存为新版本').disabled, false)
})

test('摘要弹窗分别显示项目前置审核通过和剧集审核失败，返回按钮不串任务', async t => {
  const root = dom(t), p = project(), loads = []
  const steps = [
    { id: 'project-review', kind: 'review', target: 'project-summary', status: 'done', output: { passed: true }, responses: [{ id: 'response-a' }] },
    { id: 'episode-review', kind: 'review', target: 'summary', status: 'paused', error: 'upstream service error', responses: [{ id: 'response-b' }] },
  ]
  const open = episodeDialog(root, async () => {}, async (_, __, { onTask }) => {
    onTask({ id: 'run', status: 'paused', steps })
    throw new Error('upstream service error')
  }, { loadResponses: async (_, task, node) => { loads.push([task.id, node.id]); return { responses: [] } } })
  open(p, null)
  const dialog = root.querySelector('#edit-episode')
  await button(dialog, 'AI 生成').onclick()
  const sections = [...dialog.querySelectorAll('.episode-summary-task')]
  assert.equal(sections.length, 2)
  assert.match(sections[0].textContent, /项目摘要：完成/); assert.match(sections[0].textContent, /审核通过/)
  assert.match(sections[1].textContent, /摘要：待处理/); assert.match(sections[1].textContent, /upstream service error/)
  assert.equal(dialog.querySelectorAll('.task-step-elapsed').length, 0)
  for (const section of sections) { button(section, '查看原始返回').click(); await new Promise(resolve => setImmediate(resolve)) }
  assert.deepEqual(loads, [['run', 'project-review'], ['run', 'episode-review']])
})
