// 动态修订节点与操作状态推导（计划-操作任务节点三层模型 阶段 A）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runTextSteps } from '../server/runtime/text-generation.js'
import { executionContext } from '../server/runtime/task-context.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { createStep } from '../server/runtime/task-state.js'
import { DEFAULT_MAX_REVISIONS, maxRevisionsOf, textNodes } from '../shared/task-nodes.js'
import { TaskStatus, deriveOperationStatus, deriveTaskStatus } from '../shared/task-steps.js'
import { textSteps } from '../server/flow/operations/plan-steps.js'
import { definitions } from '../server/flow/operations/operation-registry.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'

const prompts = {
  generation: { skill: 'node-test', system: '', user: 'generate' },
  review: text => ({ skill: 'node-test', system: '', user: `review:${text}` }),
  revision: base => ({ skill: 'node-test', system: '', user: `revise:${base}` }),
}
// verdicts：依次为自审、各轮复审的结论；返回实际执行的步骤与请求。
async function run({ verdicts, maxRevisions, contextMax }) {
  const calls = [], steps = textNodes('summary').map(step => createStep(step, 'model'))
  const context = { steps, outputs: [], baselines: new Map(), taskId: 't', projectId: 'p', home: '/nonexistent', operation: { projectId: 'p', episodeId: 'e', action: 'episode-generate' }, store: { update: async (_c, _id, value) => typeof value === 'function' ? value({}) : value } }
  let reviews = 0, revisions = 0
  const request = async message => {
    calls.push(message.user.split(':')[0])
    if (message.user.startsWith('review')) return verdicts[reviews++] ? reviewPass : reviewFail(`第${reviews}次审核不通过`)
    if (message.user.startsWith('revise')) return `修订稿${++revisions}`
    return '初稿'
  }
  const spec = { target: 'summary', prompts, options: { request }, persist: async () => true, ...(maxRevisions === undefined ? {} : { maxRevisions }) }
  const result = await executionContext.run(context, () => checkContext.run({ maxRevisions: contextMax }, () => runTextSteps(spec)))
  return { result, steps, calls }
}
const shape = steps => steps.map(step => `${step.kind}${step.round ? '#' + step.round : ''}:${step.status}${step.verdict ? ':' + step.verdict : ''}`)

test('文本任务只计划「生成 → 自审」，修订节点不预先放入', () => {
  assert.deepEqual(textSteps('summary').map(step => step.kind), ['generate', 'review'])
  assert.deepEqual(definitions.outline.plan().map(step => step.kind), ['generate', 'review', 'generate', 'review', 'generate', 'review', 'generate', 'review'])
})

test('自审通过时没有修订节点', async () => {
  const { steps, calls } = await run({ verdicts: [true], maxRevisions: 2 })
  assert.deepEqual(shape(steps), ['generate:completed', 'review:completed:pass'])
  assert.deepEqual(calls, ['generate', 'review'])
  assert.equal(deriveTaskStatus(steps), TaskStatus.COMPLETED)
})

test('maxRevisions=2 且连续不通过：追加两轮后结束为审核未通过', async () => {
  const { steps, result } = await run({ verdicts: [false, false, false], maxRevisions: 2 })
  assert.deepEqual(shape(steps), ['generate:completed', 'review:completed:fail', 'revise#1:completed', 're_review#1:completed:fail', 'revise#2:completed', 're_review#2:completed:fail'])
  assert.ok(steps.every(step => !step.unplanned))
  assert.equal(result.text, '修订稿2')
  assert.equal(deriveTaskStatus(steps), TaskStatus.REVIEW_FAILED)
})

test('第一轮复审通过即停止，不再追加', async () => {
  const { steps } = await run({ verdicts: [false, true], maxRevisions: 2 })
  assert.deepEqual(shape(steps), ['generate:completed', 'review:completed:fail', 'revise#1:completed', 're_review#1:completed:pass'])
  assert.equal(deriveTaskStatus(steps), TaskStatus.COMPLETED)
})

test('maxRevisions=0：自审不通过直接结束，不追加节点', async () => {
  const { steps, calls } = await run({ verdicts: [false], maxRevisions: 0 })
  assert.deepEqual(shape(steps), ['generate:completed', 'review:completed:fail'])
  assert.deepEqual(calls, ['generate', 'review'])
  assert.equal(deriveTaskStatus(steps), TaskStatus.REVIEW_FAILED)
})

test('修订上限来自任务定义（操作上下文），未配置时默认 2', async () => {
  assert.equal(DEFAULT_MAX_REVISIONS, 2)
  assert.equal(maxRevisionsOf(undefined), 2)
  assert.equal(maxRevisionsOf(-1), 2)
  assert.equal(maxRevisionsOf(0), 0)
  assert.equal((await run({ verdicts: [false, false, false, false], contextMax: 1 })).steps.filter(step => step.kind === 'revise').length, 1)
  assert.equal((await run({ verdicts: [false, false, false, false] })).steps.filter(step => step.kind === 'revise').length, 2)
  for (const action of ['episode-generate', 'episode-summary-draft', 'outline', 'characters', 'scenes', 'props', 'shots', 'revise-shot', 'seconds', 'shot-seconds']) assert.equal(definitions[action].maxRevisions, 2, action)
  for (const action of ['shot-storyboard', 'storyboard', 'film', 'films', 'image', 'revise-image']) assert.equal(definitions[action].maxRevisions, 0, action)
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
