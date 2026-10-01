import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderNodeSkill } from '../client/node-skill.js'
import { renderTaskHistory } from '../client/execution-history.js'
import { episodeDialog } from '../client/overview.js'
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<main></main>'), prior = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = prior; dom.window.close() })
  return dom.window.document.querySelector('main')
}
test('节点补充可增改删，失败保留输入，预览展示四类完整请求', async t => {
  const root = setup(t), calls = [], data = { skill: { constraints: '固定基础', fields: [{ field: 'review', text: '本节点验收' }], protocol: '协议' }, items: [] }
  const view = renderNodeSkill({ title: '测试' }, 'scenes', {
    load: async () => data, back() {},
    save: async fields => { calls.push(fields); if (!fields.content) throw new Error('内容不能为空'); data.items = [{ id: fields.id || 'a', content: fields.content }]; return data },
    remove: async id => { calls.push(id); data.items = []; return data },
    preview: async () => ({ requests: Object.fromEntries(['generate', 'modify', 'review', 'revise'].map(key => [key, { system: [{ title: '角色', text: '完整规则' }], user: [{ title: '资料', text: '完整上下文' }] }])) }),
  })
  root.append(view); await settle()
  const button = text => [...view.querySelectorAll('button')].find(item => item.textContent === text)
  let input = view.querySelector('textarea'); input.value = ''
  button('添加补充 skill').click(); await settle(); assert.match(view.textContent, /内容不能为空/)
  input.value = '第一版'; button('添加补充 skill').click(); await settle()
  button('修改').click(); input = view.querySelector('textarea'); assert.equal(input.value, '第一版')
  input.value = '第二版'; button('保存修改').click(); await settle(); assert.equal(calls.at(-1).id, 'a')
  button('预览完整提示词').click(); await settle(); assert.equal(view.querySelectorAll('details').length, 5); assert.match(view.textContent, /完整上下文/)
  button('删除').click(); await settle(); assert.equal(data.items.length, 0)
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
