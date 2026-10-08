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
  assert.deepEqual([...view.querySelectorAll('.library-tab')].map(item => item.textContent), ['角色库'])
  assert.equal(view.querySelector('.library-tab[aria-selected="true"]').textContent, '角色库')
  assert.equal(view.querySelectorAll('.library-tab-panel')[0].hidden, false)
  assert.equal(view.querySelectorAll('.library-empty').length, 1)
  assert.equal([...view.querySelectorAll('button')].some(item => /查看与管理/.test(item.textContent)), false)
  assert.match(view.querySelector('.library-empty').textContent, /根据剧集自动提取人物角色/)
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

test('项目库只展示人物横向卡片，已有场景道具没有入口', async t => {
  const root = dom(t), calls = [], p = { ...project(), library: {
    characters: [{ id: 'c1', name: '黄蓉', aliases: [], variants: [{ id: 'cv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'cv1' }],
    scenes: [{ id: 's1', name: '桃花岛', aliases: [], variants: [{ id: 'sv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'sv1' }],
    props: [{ id: 'p1', name: '玉箫', aliases: [], variants: [{ id: 'pv1', label: '默认', image: { content: {} }, fields: {} }], defaultVariantId: 'pv1' }],
  } }
  const view = renderOverview(p, { openLibraryEntry: (...args) => calls.push(args) }, {})
  root.append(view)
  assert.equal(view.querySelectorAll('.library-card').length, 1)
  assert.equal(view.querySelectorAll('.library-tab-panel .characters-strip').length, 1)
  view.querySelector('[aria-label="角色库详情：黄蓉"]').click()
  assert.deepEqual(calls[0], [p, 'characters', 'c1'])
  assert.equal(view.querySelector('[aria-label="场景库详情：桃花岛"]'), null)
  assert.equal(view.querySelector('[aria-label="道具库详情：玉箫"]'), null)
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
  assert.equal(button(dialog, 'AI 生成'), undefined)
  await form.onsubmit({ preventDefault() {} })
  assert.equal(calls[0][1].savePremise, undefined); assert.equal(calls[0][1].requirements, '旧信引出往事'); assert.equal(dialog.open, false)
})

for (const mode of ['free', 'script']) {
  test(`${mode} 摘要保存成功立即关闭，不等待后台回写或显示回写方案`, async t => {
    const root = dom(t), p = { ...project(), mode }; let saves = 0, observes = 0
    const open = episodeDialog(root, async () => { saves++; return { syncRunId: 'sync', result: { episodeId: 'e', scriptSyncError: '后台回写未完成' } } }, async () => {}, {
      observeSync: async () => { observes++; return new Promise(() => {}) }, openScript() { assert.fail('不能自动打开剧本') },
    })
    open(p, { id: 'e', durationSeconds: 10, summary: node('summary', '本集剧情') })
    const dialog = root.querySelector('dialog')
    await dialog.querySelector('form').onsubmit({ preventDefault() {} })
    assert.equal(dialog.open, false); assert.equal(saves, 1); assert.equal(observes, 0)
    assert.doesNotMatch(dialog.textContent, /回写|按方案修改剧本|尚未完成同步/)
  })
}

test('无导入剧本的方向入口在自动回写后仍展示，编辑保存原有方向', async t => {
  const root = dom(t), calls = [], p = { ...project(), mode: 'free', scriptKind: 'assembled', premise: '长期寻找失踪家人', script: '首集已回写剧情' }
  const open = premiseDialog(root, async (current, text) => calls.push([current.id, text]))
  const view = renderOverview(p, { openPremise: open }, {})
  root.append(view)
  assert.equal(view.querySelector('h3').textContent, 'AI 创作方向')
  assert.doesNotMatch(view.textContent, /持续指导每一集摘要/)
  assert.ok(view.querySelector('[aria-label="编辑 AI 创作方向"]'))
  view.querySelector('[aria-label="编辑 AI 创作方向"]').click()
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

test('剧集弹窗仅设时长和要求，没有摘要创作或任务入口',t=>{
 const root=dom(t);episodeDialog(root,async()=>{})(project(),null)
 const dialog=root.querySelector('#edit-episode')
 assert.equal(dialog.querySelector('[name=summary]'),null);assert.equal(dialog.querySelector('.ai-summary'),null);assert.equal(dialog.querySelector('.task-history-entry'),null)
})

for (const outcome of ['cancelled', 'failed']) {
  test(`剧集保存 ${outcome} 保留弹框和输入，可再次保存`, async t => {
    const root = dom(t)
    const open = episodeDialog(root, async () => {
      if (outcome === 'failed') throw new Error('模拟保存失败')
      return { cancelled: true }
    }, async () => {})
    open(project(), null)
    const dialog = root.querySelector('#edit-episode'), form = dialog.querySelector('form')
    form.elements.requirements.value = '尚未保存的剧情'
    await form.onsubmit({ preventDefault() {} })
    assert.equal(dialog.open, true); assert.equal(form.elements.requirements.value, '尚未保存的剧情')
    assert.equal(form.querySelector('[type=submit]').disabled, false)
    if (outcome === 'failed') assert.match(dialog.querySelector('.error').textContent, /模拟保存失败/)
  })
}
