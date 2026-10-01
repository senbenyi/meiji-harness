import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderSkillDetail } from '../client/skill-detail.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
 const dom = new JSDOM('<main></main>'), prior = globalThis.document
 globalThis.document = dom.window.document
 t.after(() => { globalThis.document = prior; dom.window.close() })
 return dom.window.document.querySelector('main')
}
test('基础只读直接展示，只有返回标题，无解释导航协议预览，读取失败可重试', async t => {
 const root = setup(t)
 const skill = { id: 'test', label: '测试', kind: 'stage', fields: [{ field: 'generate', text: '生成正文' }], protocol: '协议正文', guidance: [{ name: 'action' }], related: ['shots'] }
 let loads = 0, returned = 0
 const page = renderSkillDetail({ id: 'test' }, {
  back() { returned++ }, load: async () => { if (++loads === 1) throw new Error('读取失败'); return { skill } },
 })
 root.append(page)
 const click = text => [...page.querySelectorAll('button')].find(node => node.textContent === text).click()
 await settle(); assert.match(page.textContent, /读取失败/)
 click('重新加载'); await settle()
 assert.equal(page.querySelector('.skill-base pre').textContent, '生成正文')
 assert.equal(page.querySelectorAll('h2').length, 1)
 assert.equal(page.querySelectorAll('[role=tab]').length, 2)
 assert.equal(page.querySelector('[aria-selected=true]').textContent, '基础 skill')
 assert.equal(page.querySelector('.skill-additions').hidden, true)
 assert.equal(page.querySelector('.skill-preview, .skill-page-nav, .skill-guidance, .skill-assets'), null)
 assert.doesNotMatch(page.textContent, /协议正文|对所有剧|落点|预览/)
 click('← 返回'); assert.equal(returned, 1)
})
test('补充直接编辑保存，失败保留输入且不触发预览', async t => {
 const root = setup(t), calls = []
 const page = renderSkillDetail({ id: 'test', project: { title: '项目' } }, {
  back() {}, load: async () => ({ skill: { label: '测试', constraints: '基础正文', fields: [{ field: 'generate' }] }, project: { additions: { generate: '原补充' } } }),
  saveAddition: async value => { calls.push(value); if (calls.length === 1) throw new Error('保存失败') },
  preview() { assert.fail('不应预览') },
 })
 root.append(page); await settle()
 page.querySelectorAll('[role=tab]')[1].click()
 const input = page.querySelector('textarea'), save = page.querySelector('.skill-additions button')
 assert.equal(input.value, '原补充')
 input.value = '新补充'; page.querySelectorAll('[role=tab]')[0].click(); page.querySelectorAll('[role=tab]')[1].click(); assert.equal(input.value, '新补充'); await save.onclick()
 assert.match(page.textContent, /保存失败/); assert.equal(input.value, '新补充'); assert.equal(save.disabled, false)
 await save.onclick()
 assert.deepEqual(calls, [{ generate: '新补充' }, { generate: '新补充' }])
 assert.match(page.textContent, /已保存/)
})
