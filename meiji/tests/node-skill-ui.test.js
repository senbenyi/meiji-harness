import { actionRequest } from '../client/goal-request.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderNodeSkill } from '../client/node-skill.js'
import { episodeDialog } from '../client/project-overview-view.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<main></main>'), prior = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = prior; dom.window.close() })
  return dom.window.document.querySelector('main')
}
test('默认基础 tab，补充整段载入并保存，切换和失败保留输入', async t => {
  const root = setup(t), calls = []
  const view = renderNodeSkill({}, 'scenes', {
    back() {}, load: async () => ({ skill: { constraints: '基础正文', fields: [], protocol: '协议' }, items: [{ id: 'a', content: '甲' }, { id: 'b', content: '乙' }] }),
    save: async value => { calls.push(value); if (calls.length === 1) throw new Error('保存失败') },
  })
  root.append(view); await settle()
  const tabs = view.querySelectorAll('[role=tab]'), base = view.querySelector('.skill-base'), additions = view.querySelector('.skill-additions')
  assert.equal(tabs.length, 2); assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
  assert.equal(base.hidden, false); assert.equal(additions.hidden, true)
  tabs[1].click(); assert.equal(base.hidden, true); assert.equal(additions.hidden, false)
  const input = view.querySelector('textarea'), save = additions.querySelector('button')
  assert.equal(input.value, '甲\n\n乙')
  assert.equal(view.querySelector('.skill-supplement-card, .skill-preview'), null)
  input.value = '整段新意见'; tabs[0].click(); tabs[1].click(); assert.equal(input.value, '整段新意见')
  await save.onclick(); assert.match(view.textContent, /保存失败/); assert.equal(input.value, '整段新意见')
  await save.onclick(); assert.deepEqual(calls.at(-1), { content: '整段新意见', replace: true })
  input.value = ''; await save.onclick(); assert.deepEqual(calls.at(-1), { content: '', replace: true })
})
test('创建剧集弹框不再提供摘要生成和任务历史，保留时长与要求',t=>{
 const root=setup(t); root.ownerDocument.defaultView.HTMLDialogElement.prototype.show=function(){this.open=true}; const open=episodeDialog(root,async()=>{})
 open({id:'project'},null)
 assert.equal(root.querySelector('[name=summary]'),null);assert.equal(root.querySelector('.ai-summary'),null)
 assert.ok(root.querySelector('[name=duration]'));assert.ok(root.querySelector('[name=requirements]'))
})

test('节点页加载失败可以重试', async t => {
  const root = setup(t); let loads = 0
  const view = renderNodeSkill({}, 'outline', { back() {}, load: async () => { if (++loads === 1) throw new Error('网络失败'); return { skill: { constraints: '规则', fields: [] }, items: [] } } })
  root.append(view); await settle(); assert.match(view.textContent, /网络失败/)
  const retry = [...view.querySelectorAll('button')].find(button => button.textContent === '重新加载')
  retry.click(); await settle()
  assert.equal(view.querySelector('[aria-selected=true]').textContent, '基础 skill')
})
