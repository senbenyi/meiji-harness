import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderNodeSkill } from '../client/node-skill.js'
import { renderTaskHistory } from '../client/execution-history.js'
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
test('历史刷新保留任务展开，步骤更新并高亮当前步骤', async t => {
  const root = setup(t), task = { id: 't', action: 'outline', status: 'running', steps: [{ id: 's', target: 'outline', kind: 'generate', status: 'running' }], artifacts: [] }
  const view = renderTaskHistory({ title: '测试', episodeId: 'e' }, { load: async () => ({ tasks: [structuredClone(task)] }), back() {}, historyScope: 'outline' })
  root.append(view); await settle(); view.querySelector('.task-history-item').open = true
  assert.ok(view.querySelector('[aria-current="step"]'))
  task.status = 'completed'; task.steps[0].status = 'completed'; await view.refresh()
  assert.equal(view.querySelector('.task-history-item').open, true); assert.equal(view.querySelector('[aria-current="step"]'), null)
  assert.equal(view.querySelector('.task-history-header button:last-child').type, 'button')
})
test('摘要弹框任务回调实时显示步骤，历史入口不触发表单提交', async t => {
  const root = setup(t)
  const open = episodeDialog(root, async () => {}, async (_p, _input, options) => {
    options.onTask({ id: 't', status: 'running', steps: [{ id: 's', target: 'summary', kind: 'generate', status: 'running' }] })
    assert.ok(root.querySelector('[aria-current="step"]'))
    return { summary: '有效摘要', durationSeconds: 150 }
  })
  const dialog = root.querySelector('dialog'); dialog.show = () => { dialog.open = true }
  open({ id: 'p' }); await root.querySelector('.ai-summary').onclick()
  assert.match(root.textContent, /摘要任务：执行中/)
  assert.match(root.textContent, /查看摘要任务历史/)
})
test('节点页加载失败可以重试', async t => {
  const root = setup(t); let loads = 0
  const view = renderNodeSkill({}, 'outline', { back() {}, load: async () => { if (++loads === 1) throw new Error('网络失败'); return { skill: { constraints: '规则', fields: [] }, items: [] } } })
  root.append(view); await settle(); assert.match(view.textContent, /网络失败/)
  const retry = [...view.querySelectorAll('button')].find(button => button.textContent === '重新加载')
  retry.click(); await settle()
  assert.equal(view.querySelector('[aria-selected=true]').textContent, '基础 skill')
})
