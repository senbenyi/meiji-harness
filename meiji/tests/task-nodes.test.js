import { operationRequest } from '../client/operation-request.js'
// 动态修订节点与操作状态推导（计划-操作任务节点三层模型 阶段 A）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runTextNodes } from '../server/runtime/text-generation.js'
import { executionContext } from '../server/runtime/task-context.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { createNode } from '../server/runtime/task-state.js'
import { DEFAULT_MAX_REVISIONS, maxRevisionsOf, textNodes } from '../shared/task-nodes.js'
import { TaskStatus, deriveOperationStatus, deriveTaskStatus } from '../shared/task-nodes.js'
import { taskRegistry } from '../server/flow/tasks/task-registry.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'

const prompts = {
  generation: { skill: 'node-test', system: '', user: 'generate' },
  review: text => ({ skill: 'node-test', system: '', user: `review:${text}` }),
  revision: base => ({ skill: 'node-test', system: '', user: `revise:${base}` }),
}
// verdicts：依次为自审、各轮复审的结论；返回实际执行的步骤与请求。
async function run({ verdicts, maxRevisions, contextMax }) {
  const calls = [], nodes = textNodes('summary').map(step => createNode(step, 'model'))
  const context = { nodes, outputs: [], baselines: new Map(), taskId: 't', projectId: 'p', home: '/nonexistent', operation: operationRequest('episode-generate', { projectId: 'p', episodeId: 'e' }), store: { update: async (_c, _id, value) => typeof value === 'function' ? value({}) : value } }
  let reviews = 0, revisions = 0
  const request = async message => {
    calls.push(message.user.split(':')[0])
    if (message.user.startsWith('review')) return verdicts[reviews++] ? reviewPass : reviewFail(`第${reviews}次审核不通过`)
    if (message.user.startsWith('revise')) return `修订稿${++revisions}`
    return '初稿'
  }
  const spec = { target: 'summary', prompts, options: { request }, persist: async () => true, ...(maxRevisions === undefined ? {} : { maxRevisions }) }
  const result = await executionContext.run(context, () => checkContext.run({ maxRevisions: contextMax }, () => runTextNodes(spec)))
  return { result, nodes, calls }
}
const shape = nodes => nodes.map(step => `${step.kind}${step.round ? '#' + step.round : ''}:${step.status}${step.verdict ? ':' + step.verdict : ''}`)

test('文本任务只计划「生成 → 自审」，修订节点不预先放入', () => {
  assert.deepEqual(textNodes('summary').map(step => step.kind), ['generate', 'review'])
  assert.deepEqual(taskRegistry.outline.nodes({}).map(step => step.kind), ['generate', 'review'])
})

test('自审通过时没有修订节点', async () => {
  const { nodes, calls } = await run({ verdicts: [true], maxRevisions: 2 })
  assert.deepEqual(shape(nodes), ['generate:completed', 'review:completed:pass'])
  assert.deepEqual(calls, ['generate', 'review'])
  assert.equal(deriveTaskStatus(nodes), TaskStatus.COMPLETED)
})

test('maxRevisions=2 且连续不通过：追加两轮后结束为审核未通过', async () => {
  const { nodes, result } = await run({ verdicts: [false, false, false], maxRevisions: 2 })
  assert.deepEqual(shape(nodes), ['generate:completed', 'review:completed:fail', 'revise#1:completed', 're_review#1:completed:fail', 'revise#2:completed', 're_review#2:completed:fail'])
  assert.ok(nodes.every(step => !step.unplanned))
  assert.equal(result.text, '修订稿2')
  assert.equal(deriveTaskStatus(nodes), TaskStatus.REVIEW_FAILED)
})

test('第一轮复审通过即停止，不再追加', async () => {
  const { nodes } = await run({ verdicts: [false, true], maxRevisions: 2 })
  assert.deepEqual(shape(nodes), ['generate:completed', 'review:completed:fail', 'revise#1:completed', 're_review#1:completed:pass'])
  assert.equal(deriveTaskStatus(nodes), TaskStatus.COMPLETED)
})

test('maxRevisions=0：自审不通过直接结束，不追加节点', async () => {
  const { nodes, calls } = await run({ verdicts: [false], maxRevisions: 0 })
  assert.deepEqual(shape(nodes), ['generate:completed', 'review:completed:fail'])
  assert.deepEqual(calls, ['generate', 'review'])
  assert.equal(deriveTaskStatus(nodes), TaskStatus.REVIEW_FAILED)
})

test('修订上限来自任务定义（操作上下文），未配置时默认 2', async () => {
  assert.equal(DEFAULT_MAX_REVISIONS, 2)
  assert.equal(maxRevisionsOf(undefined), 2)
  assert.equal(maxRevisionsOf(-1), 2)
  assert.equal(maxRevisionsOf(0), 0)
  assert.equal((await run({ verdicts: [false, false, false, false], contextMax: 1 })).nodes.filter(step => step.kind === 'revise').length, 1)
  assert.equal((await run({ verdicts: [false, false, false, false] })).nodes.filter(step => step.kind === 'revise').length, 2)
  for (const type of ['summary', 'outline', 'characters', 'scenes', 'props', 'shot-table', 'shot-seconds']) assert.equal(taskRegistry[type].maxRevisions, 2, type)
  for (const type of ['storyboard-prompt', 'video', 'character-image', 'scene-image', 'prop-image']) assert.equal(taskRegistry[type].maxRevisions, 0, type)
})

test('操作状态由任务状态推导，失败与审核未通过优先于因停止规则产生的取消', () => {
  const { QUEUED, RUNNING, COMPLETED, FAILED, REVIEW_FAILED, CANCELLED } = TaskStatus
  assert.equal(deriveOperationStatus([]), COMPLETED)
  assert.equal(deriveOperationStatus([QUEUED, QUEUED]), QUEUED)
  assert.equal(deriveOperationStatus([COMPLETED, RUNNING, QUEUED]), RUNNING)
  assert.equal(deriveOperationStatus([COMPLETED, QUEUED]), RUNNING)
  assert.equal(deriveOperationStatus([COMPLETED, FAILED, CANCELLED, CANCELLED]), FAILED)
  assert.equal(deriveOperationStatus([COMPLETED, REVIEW_FAILED, CANCELLED]), REVIEW_FAILED)
  assert.equal(deriveOperationStatus([COMPLETED, CANCELLED, CANCELLED]), CANCELLED)
  assert.equal(deriveOperationStatus([COMPLETED, COMPLETED]), COMPLETED)
})
