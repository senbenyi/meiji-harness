// 操作记录（计划-操作任务节点三层模型 阶段 B4）：一次发起一条操作记录，任务记录经 operationId 关联，状态由任务推导。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { runOperation } from './fixtures/operation.js'
import { recordStore } from '../server/data/task-store.js'
import { setupModel } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'

test('生成操作：操作记录关联任务记录，操作状态由任务推导并在结束时落定', async t => {
  const e = await setupModel(t)
  const manager = createOperationManager({ home: e.home, execute: async () => ['完成'] })
  const started = manager.start(e.op('shot-table', {}))
  assert.notEqual(started.operationId, started.taskId)
  const result = await started.done
  assert.equal(result.operationId, started.operationId); assert.equal(result.tasks[0].id, started.taskId)
  const history = recordStore(e.home, e.id)
  const operation = await history.read('operations', started.operationId), task = await history.read('tasks', started.taskId)
  assert.deepEqual(operation.taskIds, [started.taskId])
  assert.equal(task.operationId, started.operationId)
  assert.equal(operation.status, 'completed'); assert.ok(operation.endedAt)
  assert.equal(operation.initiator, 'panel')
})

test('停止：按任务 id 也停止整个操作，操作记录为已取消', async t => {
  const e = await setupModel(t)
  const manager = createOperationManager({ home: e.home, execute: async (_op, deps) => new Promise((_, reject) => deps.signal.addEventListener('abort', () => reject(deps.signal.reason), { once: true })) })
  const started = manager.start(e.op('shot-table', {}))
  while (!started.taskId) await new Promise(resolve => setImmediate(resolve))
  manager.cancel(started.taskId, e.id)
  assert.equal((await started.done).status, 'cancelled')
  assert.equal((await recordStore(e.home, e.id).read('operations', started.operationId)).status, 'cancelled')
})

test('直接操作：不排队，同样写操作记录与关联的任务记录', async t => {
  const e = await setupModel(t)
  const manager = createOperationManager({ home: e.home, execute: runOperation })
  await manager.start(e.op('outline-text', { outline: outlineFixture('面板改写的大纲') }), null, { reviewContent: async () => ({ passed: true, failures: [] }) }).done
  const history = recordStore(e.home, e.id)
  const [operation] = await history.list('operations'), [task] = await history.list('tasks')
  assert.equal(operation.action, 'outline-text'); assert.deepEqual(operation.taskIds, [task.id])
  assert.equal(task.operationId, operation.id)
  assert.ok(operation.endedAt)
})

test('删除剧集同时清理其操作记录', async t => {
  const e = await setupModel(t)
  const manager = createOperationManager({ home: e.home, execute: async () => ['完成'] })
  await manager.start(e.op('shot-table', {})).done
  const history = recordStore(e.home, e.id)
  assert.equal((await history.list('operations')).length, 1)
  await history.removeEpisode(e.episodeId)
  assert.deepEqual(await history.list('operations'), [])
})
