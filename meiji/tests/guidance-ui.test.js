import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { skillField } from '../client/skill-entry.js'
import { renderSkillDetail } from '../client/skill-detail.js'
import { renderSkillLibrary } from '../client/skill-library.js'
import { renderLibrary } from '../client/library.js'

function domSetup(t) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' })
  const prior = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
}
const assets = [{ id: 'one', category: 'guidance', originalName: '风声.md', guidanceType: 'sound', content: '风声由远及近', mime: 'text/plain', size: 20, createdAt: '2026-01-01' }, { id: 'two', category: 'guidance', originalName: '表情.md', guidanceType: 'expression', content: '<script>alert(1)</script>', mime: 'text/plain', size: 20, createdAt: '2026-01-01' }]
const settle = () => new Promise(resolve => setImmediate(resolve))
const field = (name, text, extra = {}) => ({ field: name, text, builtin: text, layer: 'builtin', outdated: false, previous: false, ...extra })
const storyboard = {
  id: 'storyboard', kind: 'stage', label: '文本分镜', related: [], stages: [], protocol: '首行返回 [opening-reference: none]',
  fields: [field('common', '通用正文'), field('generate', '生成正文'), field('review', '审核正文', { layer: 'base', builtin: '旧审核', outdated: true, previous: true }), field('revise', '修订正文')],
  guidance: [{ id: 'guidance-action', name: 'action', label: '动作指导', placement: '画面描述', defaultEnabled: true }, { id: 'guidance-martial', name: 'martial', label: '武术指导', placement: '画面描述', defaultEnabled: false }],
}
const click = (root, text) => [...root.querySelectorAll('button')].find(button => button.textContent === text).click()

test('stage entries open the stage skill and show drama status', async t => {
  domSetup(t)
  const opened = [], project = { id: 'p', skills: { additions: { video: { generate: '保持节奏' } }, assets: { film: [assets[0]] } } }
  const row = skillField(project, 'film', { openSkill: (...args) => opened.push(args), skillList: async () => [{ id: 'video', modified: ['generate'] }] })
  await settle()
  assert.match(row.textContent, /成片 · skill/)
  assert.match(row.querySelector('button').textContent, /查看 skill · 基础已改 · 本剧补充 · 1 素材/)
  row.querySelector('button').click()
  assert.deepEqual(opened, [[project, 'video']])
  assert.equal(skillField({}, 'outline', { openSkill() {} }).querySelector('button').textContent, '查看 skill')
})

test('skill detail shows base fields, saves edits only after confirming they apply to every drama, and restores', async t => {
  domSetup(t)
  const calls = []
  const page = renderSkillDetail({ id: 'storyboard', project: { title: '沙漠' } }, {
    back() {}, open() {}, loadAssets: async () => ({ assets }),
    load: async () => ({ skill: storyboard, project: { additions: { generate: '本剧冷色调' }, enabled: ['action'], assets: {} } }),
    saveBase: async fields => { calls.push(['base', fields]); return { skill: { ...storyboard, fields: storyboard.fields.map(item => item.field === 'generate' ? { ...item, text: fields.generate, layer: 'base' } : item) } } },
    reset: async (to, name) => { calls.push(['reset', to, name]); return { skill: storyboard } },
    saveAddition: async fields => calls.push(['addition', fields]),
    saveGuidance: async enabled => calls.push(['guidance', enabled]),
    saveAssets: async (stage, ids) => calls.push(['assets', stage, ids]),
    preview: async mode => { calls.push(['preview', mode]); return { requests: { generate: { chars: 12, system: [{ source: 'stage', title: '【阶段技能·生成】', text: '生成正文' }, { source: 'project', title: '【本剧补充·生成】', text: '本剧冷色调' }], user: [{ source: 'context', title: '【任务与上下文】', text: '上下文' }] }, modify: null } } },
  })
  document.body.append(page)
  await settle()
  assert.match(page.textContent, /文本分镜 · skill/)
  assert.match(page.querySelector('.skill-base .skill-text').textContent, /生成正文/)
  // 协议只读
  click(page.querySelector('.skill-base [role=tablist]'), '协议（只读）')
  assert.match(page.querySelector('.skill-base').textContent, /不可编辑/)
  assert.equal([...page.querySelector('.skill-base').querySelectorAll('button')].some(button => button.textContent === '编辑'), false)
  // 编辑生成字段：先确认再保存
  click(page.querySelector('.skill-base [role=tablist]'), '生成')
  click(page.querySelector('.skill-base'), '编辑')
  page.querySelector('.skill-base textarea').value = '新的生成正文'
  click(page.querySelector('.skill-base'), '保存')
  assert.deepEqual(calls, [])
  assert.match(page.querySelector('.skill-confirm').textContent, /对所有剧生效/)
  click(page.querySelector('.skill-base'), '确认保存')
  await settle()
  assert.deepEqual(calls.shift(), ['base', { generate: '新的生成正文' }])
  assert.match(page.textContent, /已保存基础 skill/)
  // 已修改且内置已更新的审核字段：可对比、恢复内置、撤回上一版
  click(page.querySelector('.skill-base [role=tablist]'), '审核')
  assert.match(page.querySelector('.skill-base').textContent, /内置已更新/)
  assert.match(page.querySelector('.skill-compare').textContent, /旧审核/)
  click(page.querySelector('.skill-base'), '撤回上一版')
  await settle()
  assert.deepEqual(calls.shift(), ['reset', 'previous', 'review'])
  // 本剧补充保存全部字段
  const addition = page.querySelector('.skill-additions textarea')
  assert.equal(addition.value, '本剧冷色调')
  click(page.querySelector('.skill-additions [role=tablist]'), '审核')
  addition.value = '核对色调'; addition.oninput()
  click(page.querySelector('.skill-additions'), '保存本剧补充')
  await settle()
  assert.deepEqual(calls.shift(), ['addition', { common: '', generate: '本剧冷色调', review: '核对色调', revise: '' }])
  // 指导启用开关
  const martial = page.querySelector('.skill-guidance input[value=martial]')
  assert.equal(martial.checked, false)
  martial.checked = true; await martial.onchange()
  assert.deepEqual(calls.shift(), ['guidance', ['action', 'martial']])
  // 指导素材按指导分组，保存到本阶段
  assert.match(page.querySelector('.skill-assets').textContent, /声音指导[\s\S]*风声.md/)
  assert.equal(page.querySelector('.skill-assets script'), null)
  page.querySelector('.skill-assets input[value=one]').click()
  click(page.querySelector('.skill-assets'), '保存指导素材')
  await settle()
  assert.deepEqual(calls.shift(), ['assets', 'storyboard', ['one']])
  // 预览按来源着色并显示字数
  page.querySelector('.skill-preview select').value = 'text'
  click(page.querySelector('.skill-preview'), '预览请求')
  await settle()
  assert.deepEqual(calls.shift(), ['preview', 'text'])
  assert.match(page.querySelector('.skill-preview-request summary').textContent, /生成 · 12 字/)
  assert.ok(page.querySelector('.skill-seg.seg-project'))
  assert.match(page.querySelector('.skill-seg.seg-project').textContent, /本剧补充/)
  assert.equal(page.querySelectorAll('.skill-preview-request').length, 1)
})

test('a failed library load or save keeps the selected guides', async t => {
  domSetup(t)
  const saved = [], asset = { ...assets[0], name: assets[0].originalName }
  const page = renderSkillDetail({ id: 'video', project: { title: '沙漠' } }, {
    back() {}, open() {}, preview: async () => ({ requests: {} }),
    load: async () => ({ skill: { id: 'video', kind: 'stage', label: '成片', related: [], stages: [], guidance: [], protocol: '', fields: [field('generate', '')] }, project: { additions: {}, enabled: [], assets: { film: [asset] } } }),
    loadAssets: async () => { throw new Error('离线') }, saveAssets: async (...args) => { saved.push(args); throw new Error('保存失败') },
  })
  await settle(); await settle()
  assert.match(page.textContent, /已选素材仍保留/)
  assert.match(page.textContent, /先编入文本分镜/)
  click(page.querySelector('.skill-assets'), '保存指导素材')
  await settle()
  assert.deepEqual(saved, [['film', ['one']]])
  assert.match(page.querySelector('.skill-assets').textContent, /保存失败/)
  assert.equal(page.querySelector('.skill-assets input[value=one]').checked, true)
  assert.equal(page.querySelector('.skill-guidance'), null)
})

test('skill library groups stage, guidance and shared skills with their modification state', async t => {
  domSetup(t)
  const opened = []
  const page = renderSkillLibrary({ back() {}, open: id => opened.push(id), load: async () => [
    { id: 'storyboard', kind: 'stage', label: '文本分镜', modified: ['review'], outdated: [] },
    { id: 'guidance-martial', kind: 'guidance', label: '武术指导', modified: [], outdated: [] },
    { id: 'shared-language', kind: 'shared', label: '语言', modified: ['text'], outdated: ['text'] },
  ] })
  await settle()
  assert.deepEqual([...page.querySelectorAll('h3')].map(node => node.textContent), ['阶段技能', '指导技能', '共享模块'])
  assert.match(page.textContent, /文本分镜已修改 1 个字段/)
  assert.match(page.textContent, /语言已修改 1 个字段 · 内置已更新/)
  page.querySelector('button[aria-label="查看 武术指导"]').click()
  assert.deepEqual(opened, ['guidance-martial'])
})

test('task history lists the skills a task used and their layers', async t => {
  domSetup(t)
  const { skillsLine } = await import('../client/execution-history.js')
  assert.equal(skillsLine([]), null)
  const line = skillsLine([{ id: 'storyboard', layers: ['builtin', 'base', 'project'], hash: 'abc' }, { id: 'guidance-action', layers: ['builtin'], hash: 'def' }])
  assert.equal(line.textContent, '所用技能：文本分镜（基础已修改、含本剧补充）、动作指导')
  assert.match(line.title, /storyboard abc/)
})

test('library filters guidance by category and imports files into the selected classification', async t => {
  domSetup(t)
  globalThis.fetch = async url => Response.json(String(url).endsWith('/projects') ? { projects: [] } : { assets: String(url).includes('category=guidance') ? assets : [] })
  const calls = [], page = renderLibrary(() => {}, { importLibrary: async (...args) => calls.push(args) })
  document.body.append(page)
  const tab = [...page.querySelectorAll('[role=tab]')].find(button => button.textContent === '指导提示词')
  tab.click(); await settle()
  const filter = page.querySelector('select'); filter.value = 'sound'; filter.onchange(); await settle()
  assert.match(page.textContent, /风声.md/)
  assert.doesNotMatch(page.querySelector('.asset-card').textContent, /表情.md/)
  assert.equal(page.querySelector('.asset-card video'), null)
  const file = new window.File(['风声'], '声音.txt', { type: 'text/plain' })
  const input = page.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: [file] })
  await input.onchange()
  assert.deepEqual(calls, [['guidance', file, 'sound']])
  assert.match(page.textContent, /已导入 1\/1/)
})
