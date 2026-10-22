import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createTaskOperation, groupTaskMessages } from '../src/client/ui/task-operation.js'

function operation(t, type, { input, result } = {}) {
  const dom = new JSDOM('<main/>'), document = dom.window.document
  let copied
  const messages = [
    { id: 'start', group_id: 'group', phase: 'start', node_type: type, operation_name: '本次操作', operation_status: 'completed', box_input: input },
    { id: 'step', group_id: 'group', phase: 'step', node_type: type, seq: 1, step_name: '生成', status: 'done', label: '已完成', input, result, operation_status: 'completed' },
    { id: 'result', group_id: 'group', phase: 'result', node_type: type, status: 'completed', operation_status: 'completed', saved: true },
  ]
  const ui = createTaskOperation(document, { getMessage: id => messages.find(message => message.id === id), copy: async text => { copied = text }, onNotify: () => {} })
  document.querySelector('main').append(ui.element)
  ui.update(groupTaskMessages(messages)[0])
  t.after(() => { ui.dispose(); dom.window.close() })
  return { root: ui.element.shadowRoot, copied: () => copied }
}

test('项目节点会话输入由节点模块展示，完整记录可以复制', async t => {
  const input = { name: '本次项目', creation_mode: '自由创作', aspect_ratio: '9:16' }
  const { root, copied } = operation(t, 'project', { input })
  const details = root.querySelector('[data-expand="box-input"]')
  details.open = true; await details.ontoggle()
  assert.match(details.textContent, /项目名称：本次项目/)
  assert.match(details.textContent, /创作模式：自由创作/)
  await [...details.querySelectorAll('button')].find(button => button.textContent === '复制盒子输入').onclick()
  assert.deepEqual(JSON.parse(copied()), input)
  assert.equal(root.querySelector('.compare'), null)
})

test('制作节点会话仅展示当次保存的数据，文本不解释成HTML', async t => {
  const result = { output: { segments: [{ title: '当次分段', body: '<img src=x>故事正文' }] } }
  const { root } = operation(t, 'story_segments', { result })
  const details = root.querySelector('[data-expand="step:step"]')
  details.open = true; await details.ontoggle()
  assert.match(details.textContent, /当次分段/)
  assert.match(details.textContent, /<img src=x>故事正文/)
  assert.equal(details.querySelector('img'), null)
  assert.match(details.textContent, /完整输出记录/)
})

test('未知节点和旧快照仍可展开完整输入输出，保留复制兜底', async t => {
  const input = { custom: '旧输入' }, result = { custom: '旧结果' }
  const { root, copied } = operation(t, 'unknown-node', { input, result })
  const details = root.querySelector('[data-expand="step:step"]')
  details.open = true; await details.ontoggle()
  assert.match(details.textContent, /旧输入/); assert.match(details.textContent, /旧结果/)
  await [...details.querySelectorAll('button')].find(button => button.textContent === '复制步骤输出').onclick()
  assert.deepEqual(JSON.parse(copied()), result)
  assert.match(root.querySelector('.outcome').textContent, /操作完成，已保存/)
})
