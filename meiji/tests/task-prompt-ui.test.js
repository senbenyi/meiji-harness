import { operationRequest } from '../client/operation-request.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { renderSteps } from '../client/task-nodes.js'
import { renderTaskHistory } from '../client/execution-history.js'
import { renderCurrentTasks } from '../client/current-task.js'

const settle = () => new Promise(resolve => setImmediate(resolve))
function setup(t) {
  const dom = new JSDOM('<!doctype html><body></body>')
  const originals = Object.fromEntries(['document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  let copied
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async value => { copied = value } } }, configurable: true })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
    dom.window.close()
  })
  return { copied: () => copied }
}
const step = { id: 'step', kind: 'generate', target: 'summary', status: 'completed', prompts: [{ id: 'prompt' }] }

test('原始返回弹层展示状态耗时及完整正文并支持关闭', async t => {
  setup(t)
  const view = renderSteps([{ ...step, responses: [{ id: 'response' }] }], { loadResponses: async () => ({ responses: [{ fn: 'completeChat', status: 200, durationMs: 123, body: { text: '完整网关返回' } }] }) })
  document.body.append(view)
  view.querySelector('.task-step-response').click(); await settle()
  const dialog = document.querySelector('dialog')
  assert.match(dialog.textContent, /完整网关返回/)
  assert.match(dialog.textContent, /123/)
  dialog.querySelector('button').click()
  assert.equal(document.querySelector('dialog'), null)
})

test('已执行旧步骤可以点击并显示日志来源或缺失原因', async t => {
  setup(t)
  let count = 0
  const view = renderSteps([{ ...step, prompts: undefined }], { loadPrompts: async () => ++count === 1
    ? { prompts: [{ messages: [{ role: 'user', content: '历史完整提示词' }] }], message: '来自当时的会话请求日志' }
    : { prompts: [], message: '旧服务未记录，请重启服务' } })
  document.body.append(view)
  const button = view.querySelector('button')
  assert.equal(button.disabled, false)
  button.click(); await settle()
  assert.match(document.querySelector('dialog').textContent, /历史完整提示词/)
  assert.match(document.querySelector('[role=status]').textContent, /会话请求日志/)
  document.querySelector('dialog').close()
  button.click(); await settle()
  assert.match(document.querySelector('dialog').textContent, /旧服务未记录，请重启服务/)
})

test('按钮按点击加载，完整显示所有请求及 role，支持复制关闭且不执行文本中的 HTML', async t => {
  const e = setup(t), full = '规则'.repeat(15000) + '<script>danger()</script>末尾'
  const messages = [{ role: 'system', content: full }, { role: 'user', content: '人物资料与意见' }]
  let calls = 0
  const view = renderSteps([step], { loadPrompts: async value => {
    assert.equal(value.id, step.id); calls++
    return { prompts: [{ messages }, { prompt: '第二次完整提示词' }] }
  } })
  document.body.append(view)
  assert.equal(calls, 0)
  const button = view.querySelector('.task-step-prompt')
  button.click(); await settle()
  const dialog = document.querySelector('dialog')
  assert.equal(calls, 1)
  assert.equal(dialog.querySelectorAll('section').length, 2)
  assert.equal(dialog.querySelector('pre').textContent, full)
  assert.equal(dialog.querySelector('script'), null)
  assert.deepEqual([...dialog.querySelectorAll('h4')].map(node => node.textContent), ['system', 'user'])
  dialog.querySelector('.json-copy').click(); await settle()
  assert.deepEqual(JSON.parse(e.copied()), messages)
  dialog.querySelector('.modal-head button').click()
  assert.equal(document.querySelector('dialog'), null)
  assert.equal(document.activeElement, button)
})

test('加载失败可以重试；旧记录可查询，未执行和跳过步骤不可查看，下载步骤无入口', async t => {
  setup(t)
  let calls = 0
  const view = renderSteps([step, ...['pending', 'skipped', 'completed'].map(status => ({ ...step, id: status, status, prompts: undefined })), { id: 'download', kind: 'image_download', status: 'completed' }], {
    loadPrompts: async () => { if (++calls === 1) throw new Error('暂时断网'); return { prompts: [{ prompt: '完整图片提示词' }] } },
  })
  document.body.append(view)
  const buttons = [...view.querySelectorAll('.task-step-prompt')]
  assert.equal(buttons.length, 4)
  assert.deepEqual(buttons.map(button => button.disabled), [false, true, true, false])
  assert.match(buttons[1].title, /尚未生成/)
  assert.match(buttons[2].title, /已跳过/)
  assert.match(buttons[3].title, /请求日志/)
  buttons[0].click(); await settle()
  const dialog = document.querySelector('dialog')
  assert.match(dialog.textContent, /加载失败：暂时断网/)
  const retry = [...dialog.querySelectorAll('button')].find(button => button.textContent === '重新加载')
  assert.equal(retry.hidden, false)
  retry.click(); await settle()
  assert.equal(dialog.querySelector('pre').textContent, '完整图片提示词')
  assert.equal(retry.hidden, true)
})

test('当前任务和历史共用按钮并传递准确任务与步骤，弹窗留在插件 ShadowRoot', async t => {
  setup(t)
  const task = operationRequest('episode-generate', { id: 'task', status: 'completed', nodes: [step], artifacts: [], actor: 'model' })
  const host = document.createElement('div'); document.body.append(host)
  const root = host.attachShadow({ mode: 'open' }), seen = []
  const loadPrompts = async (value, selected) => { seen.push([value.id, selected.id]); return { prompts: [{ prompt: '完整内容' }] } }
  const history = renderTaskHistory({ id: 'project' }, { load: async () => ({ tasks: [task] }), loadPrompts, back() {} })
  root.append(history); await settle()
  history.querySelector('.task-step-prompt').click(); await settle()
  assert.ok(root.querySelector('dialog'))
  assert.equal(document.querySelector('dialog'), null)
  root.querySelector('dialog').close()
  const current = renderCurrentTasks({ id: 'project' }, { load: async () => ({ operations: [{ id: 'operation', status: 'running', tasks: [{ ...task, status: 'running' }] }] }), loadPrompts, stop() {} })
  root.append(current); await settle()
  current.querySelector('.task-step-prompt').click(); await settle()
  assert.deepEqual(seen, [['task', 'step'], ['task', 'step']])
  current.remove()
})


test('项目摘要前置失败可用完整原操作重试，失败保留入口与参数', async t => {
  setup(t)
  const { renderOperationDetails } = await import('../client/task-detail.js')
  const operation = { id: 'operation', action: 'story', status: 'failed', parameters: { episodeId: 'episode', mode: 'modify', review: '保留冲突' }, tasks: [{ id: 'summary', type: 'project-summary', status: 'failed', nodes: [], artifacts: [] }] }
  const seen = [], view = renderOperationDetails(operation, { retry: async value => { seen.push(value); if (seen.length === 1) throw new Error('网络暂不可用') } })
  document.body.append(view)
  const button = view.querySelector('.operation-retry')
  button.click(); await settle()
  assert.equal(seen[0], operation); assert.equal(button.disabled, false); assert.match(view.textContent, /网络暂不可用/)
  button.click(); await settle(); assert.equal(seen[1], operation); assert.equal(button.disabled, true)
  assert.equal(renderOperationDetails({ ...operation, tasks: [{ ...operation.tasks[0], type: 'story' }] }, { retry() {} }).querySelector('.operation-retry'), null)
})
