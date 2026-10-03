// 多任务操作（计划-操作任务节点三层模型 阶段 C1）：步骤按 target 归入各任务，任务状态独立，任一任务失败、审核不通过或停止时其后任务取消。
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { recordStore } from '../server/data/task-store.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { runOperation } from './fixtures/operation.js'
import { planTasks } from '../server/flow/operations/operation-registry.js'
import { generateStoryPackage } from './fixtures/story-generation.js'
import { cardModel } from '../shared/drama-model.js'
import { storyPackageFixture, outlineResponse } from './fixtures/story-package.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'

const kinds = tasks => tasks.map(task => `${task.type}:${task.targets.join(',')}`)

test('任务划分：剧情 4 个任务；每秒指令、整集分镜、只生成视频按镜头；成片每镜「分镜提示词 → 视频」', async t => {
  const e = await setupModel(t)
  assert.deepEqual(kinds(await planTasks(e.home, e.op('story'))), ['outline:outline', 'characters:characters', 'scenes:scenes', 'props:props'])
  assert.deepEqual(kinds(await planTasks(e.home, e.op('seconds'))), ['shot-seconds:seconds:S01', 'shot-seconds:seconds:S02'])
  assert.deepEqual(kinds(await planTasks(e.home, e.op('film', { parts: 'storyboard' }))), ['storyboard-prompt:storyboard:S01', 'storyboard-prompt:storyboard:S02'])
  assert.deepEqual(kinds(await planTasks(e.home, e.op('film', { parts: 'video' }))), ['video:film:S01', 'video:film:S02'])
  assert.deepEqual(kinds(await planTasks(e.home, e.op('film', { track: 'S02' }))), ['storyboard-prompt:storyboard:S02', 'video:film:S02'])
  assert.deepEqual(kinds(await planTasks(e.home, e.op('film'))), ['storyboard-prompt:storyboard:S01', 'video:film:S01', 'storyboard-prompt:storyboard:S02', 'video:film:S02'])
  // 每个任务只带自己 target 的步骤。
  for (const task of await planTasks(e.home, e.op('film'))) assert.ok(task.plan.every(step => task.targets.includes(step.target)))
})

test('图片任务按卡片类型区分：角色图、场景图、道具图', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, project => { project.episodes[0].plot.props.items = [cardModel({ id: 'P01', name: '灯', type: 'prop', description: '铜灯' })]; return project })
  assert.deepEqual((await planTasks(e.home, e.op('character-image', { itemId: 'C01' }))).map(task => [task.type, task.label]), [['character-image', '角色图 C01']])
  assert.deepEqual((await planTasks(e.home, e.op('scene-image', { itemId: 'E01' }))).map(task => [task.type, task.label]), [['scene-image', '场景图 E01']])
  assert.deepEqual((await planTasks(e.home, e.op('prop-image', { itemId: 'P01' }))).map(task => [task.type, task.label]), [['prop-image', '道具图 P01']])
})

test('生成剧情：角色审核不通过 → 大纲已完成、角色审核未通过、场景与道具已取消，操作为审核未通过', async t => {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: 'test-only' })
  const fixture = storyPackageFixture()
  // 大纲生成 + 自审通过；角色生成 + 自审不通过，默认 2 轮修订复审仍不通过；场景与道具不再请求。
  const replies = [outlineResponse(), reviewPass, JSON.stringify(fixture.characters), reviewFail('缺少角色'), JSON.stringify(fixture.characters), reviewFail('缺少角色'), JSON.stringify(fixture.characters), reviewFail('缺少角色')]
  let calls = 0
  const manager = createOperationManager({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps, request: async () => { calls++; return replies.shift() } }) })
  const started = manager.start(e.op('story'))
  const result = await started.done
  assert.equal(calls, 8)
  assert.deepEqual(result.tasks.map(task => [task.type, task.status]), [['outline', 'completed'], ['characters', 'review_failed'], ['scenes', 'cancelled'], ['props', 'cancelled']])
  assert.equal(result.status, 'review_failed')
  const history = recordStore(e.home, e.id), operation = await history.read('operations', started.operationId)
  assert.equal(operation.taskIds.length, 4); assert.equal(operation.status, 'review_failed')
  // 动态修订节点归入角色任务，带轮次。
  const characters = await history.read('tasks', operation.taskIds[1])
  assert.deepEqual(characters.nodes.map(step => `${step.kind}${step.round ? '#' + step.round : ''}`), ['generate', 'review', 'revise#1', 're_review#1', 'revise#2', 're_review#2'])
  assert.ok((await history.read('tasks', operation.taskIds[2])).nodes.every(step => step.status === 'cancelled'))
})
