import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from '../../harness/node_modules/jsdom/lib/api.js'
import { renderCustomSkill, customSkillField } from '../client/custom-skills.js'
import { renderLibrary } from '../client/library.js'

function domSetup(t) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost' })
  const prior = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
}
const assets = [{ id: 'one', category: 'guidance', originalName: '风声.md', guidanceType: 'sound', content: '风声由远及近', mime: 'text/plain', size: 20, createdAt: '2026-01-01' }, { id: 'two', category: 'guidance', originalName: '表情.md', guidanceType: 'expression', content: '<script>alert(1)</script>', mime: 'text/plain', size: 20, createdAt: '2026-01-01' }]
const settle = () => new Promise(resolve => setImmediate(resolve))

test('custom skill selects categorized guides, previews module placement and saves constraints separately', async t => {
  domSetup(t)
  const saves = [], project = { customSkills: { storyboard: '保持剧情' }, guidanceAssets: {} }
  const page = renderCustomSkill(project, 'storyboard', { back() {}, loadAssets: async () => ({ assets }), save: async (...args) => saves.push(args) })
  document.body.append(page)
  await settle()
  assert.match(page.textContent, /环境音与音效 → overall_soundscape/)
  assert.equal(page.querySelector('script'), null)
  const checkbox = page.querySelector('input[value=one]')
  checkbox.click()
  const filter = page.querySelector('select'); filter.value = 'expression'; filter.onchange()
  assert.equal(page.querySelectorAll('input[type=checkbox]').length, 1)
  page.querySelector('input[value=two]').click()
  page.querySelector('textarea').value = '保持朝向'
  await page.querySelector('form').onsubmit({ preventDefault() {} })
  assert.deepEqual(saves, [['保持朝向', ['one', 'two']]])
  assert.match(page.textContent, /已保存/)
  filter.value = ''; filter.onchange()
  page.querySelector('input[value=one]').click(); page.querySelector('input[value=two]').click()
  await page.querySelector('form').onsubmit({ preventDefault() {} })
  assert.deepEqual(saves[1], ['保持朝向', []])
  assert.match(customSkillField({ guidanceAssets: { film: [assets[0]] } }, 'film', {}).textContent, /成片.*1 个指导素材/)
})

test('a failed library load or save retains the existing selection and typed constraint', async t => {
  domSetup(t)
  const saved = [], asset = { ...assets[0], name: assets[0].originalName }
  const page = renderCustomSkill({ guidanceAssets: { film: [asset] } }, 'film', {
    back() {}, loadAssets: async () => { throw new Error('离线') }, save: async (...args) => { saved.push(args); throw new Error('保存失败') },
  })
  await settle()
  assert.match(page.textContent, /已选素材仍保留/)
  assert.match(page.textContent, /先编入文本分镜/)
  page.querySelector('textarea').value = '不得改变台词'
  await page.querySelector('form').onsubmit({ preventDefault() {} })
  assert.deepEqual(saved, [['不得改变台词', ['one']]])
  assert.equal(page.querySelector('textarea').value, '不得改变台词')
  assert.equal(page.querySelector('input[value=one]').checked, true)
  assert.equal(page.querySelector('fieldset').disabled, false)
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
