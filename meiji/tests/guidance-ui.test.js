import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { skillField } from '../client/skill-entry.js'
import { renderSkillDetail } from '../client/skill-detail.js'
import { renderSkillLibrary } from '../client/skill-library.js'
import { renderLibrary } from '../client/asset-library-view.js'

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

test('固定约束只读显示，空文件显示空正文，人物图没有基础编辑或本剧补充入口', async t => {
  domSetup(t)
  for (const constraints of ['只画人物全身', '']) {
    const page = renderSkillDetail({ id: 'character-image', project: { title: '短剧' } }, {
      back() {}, load: async () => ({ skill: { id: 'character-image', kind: 'stage', label: '人物图', fields: [], constraints }, project: { additions: { generate: '旧补充' } } }),
    })
    document.body.append(page)
    await settle()
    assert.match(page.textContent, /基础 skill/)
    assert.equal(page.querySelector('.skill-base .skill-text')?.textContent || '', constraints)
    assert.equal(page.querySelector('textarea').disabled, true)
    assert.ok(page.querySelector('.skill-base'))
    assert.equal(page.querySelector('.skill-additions').hidden, true)
    assert.equal([...page.querySelectorAll('button')].some(button => /编辑|恢复|保存/.test(button.textContent) && !button.disabled), false)
    assert.doesNotMatch(page.textContent, /旧补充|undefined/)
    page.remove()
  }
})

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
  const { skillsLine } = await import('../client/run-labels.js')
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
