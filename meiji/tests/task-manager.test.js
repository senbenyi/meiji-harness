import { operationRequest } from '../client/operation-request.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { subscribeProject } from '../server/data/project-events.js'
import { setupModel, tempHome } from './fixtures/model.js'
import { sessionForLog } from '../server/host/session-log.js'

const operation = { projectId: 'p', episodeId: 'e', action: 'seconds' }
test('button tasks execute directly with isolated logs, reject duplicates and release after cancellation', async t => {
 const events = [], session = { append: (type, data) => events.push({ type, data }) }
 let signal
 const tasks = createOperationManager({ home: await tempHome(t), execute: async (op, deps) => {
  assert.equal(sessionForLog(), session)
  assert.equal(deps.waitForBackground, true)
  signal = deps.signal
  await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
 } })
 const task = tasks.start(operation, session)
 assert.equal(tasks.list('p')[0].id, task.id)
 assert.throws(() => tasks.start(operation, session), { status: 409 })
 assert.throws(() => tasks.cancel(task.id, 'other'), { status: 404 })
 tasks.cancel(task.id, 'p')
 // 任务先经过全局队列：提交后立即取消时可能尚未开始执行；若已开始，必须收到中止信号。
 assert.equal((await task.done).status, 'cancelled')
 assert.ok(!signal || signal.aborted)
 assert.deepEqual(tasks.list('p'), [])
 assert.ok(events.every(e => ['command/run', 'command/done'].includes(e.type)))
 assert.ok(events.some(e => e.data.text?.includes('操作已停止')))
})

test('failed log writes do not fail successful tasks; errors settle and release tasks', async t => {
 const home = await tempHome(t)
 const tasks = createOperationManager({ home, execute: async () => ['已保存'] })
 await tasks.start(operation, { append() { throw new Error('disconnected') } }).done
 assert.deepEqual(tasks.list('p'), [])
 const failed = createOperationManager({ home, execute: async () => { throw new Error('API failed') } })
 await failed.start(operation).done
 assert.deepEqual(failed.list('p'), [])
 assert.throws(() => tasks.start({ ...operation, action: 'unknown' }), { status: 400 })
})

test('project notification follows a committed revision and subscriptions can disconnect', async t => {
 const e = await setupModel(t), events = []
 const unsubscribe = subscribeProject(e.home, e.id, event => events.push(event))
 const saved = await e.store.save(e.id, { title: '已保存' })
 assert.deepEqual(events, [{ projectId: e.id, revision: saved.revision }])
 assert.equal((await e.store.read(e.id)).revision, events[0].revision)
 unsubscribe()
 await e.store.save(e.id, { title: '之后' })
 assert.equal(events.length, 1)
})

test('direct generation saves reviewed model and cancellation clears its operation', async t => {
 const { runOperation } = await import('./fixtures/operation.js')
 const { generateAllSeconds } = await import('./fixtures/seconds-generation.js')
 const { modelStore } = await import('../server/data/model-settings.js')
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 const events = [], session = { append: (type, data) => events.push({ type, data }) }
 const tasks = createOperationManager({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
  request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message),
 }) })
 const task = tasks.start(e.op('seconds'), session)
 await task.done
 let shot = (await e.read()).shots.items[0]
 assert.equal(shot.seconds.content.beats[0].action, '第一镜新动作')
 assert.equal(shot.seconds.status, 'passed')
 assert.equal(shot.seconds.operation, null)
 let entered
 const started = new Promise(resolve => { entered = resolve })
 const cancellable = createOperationManager({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
  generateShotSeconds: async () => {
   entered()
   await new Promise((resolve, reject) => deps.signal.addEventListener('abort', () => reject(deps.signal.reason), { once: true }))
  },
 }) })
 const pending = cancellable.start(e.op('seconds'), session)
 await started
 // 内容节点记录的归属是任务记录 id（taskId），操作 id 用于停止与查询。
 assert.equal((await e.read()).shots.items[0].seconds.operation.id, pending.taskId)
 cancellable.cancel(pending.id, e.id)
 await pending.done
 shot = (await e.read()).shots.items[0]
 assert.equal(shot.seconds.status, 'failed')
 assert.equal(shot.seconds.operation, null)
 assert.equal('activity' in await e.read(), false)
 assert.ok(events.every(e => e.type.startsWith('command/')))
})
test('单镜修订使用独立每秒指令任务', async t => {
 const e=await setupModel(t)
 const { planTasks }=await import('../server/flow/operations/operation-registry.js')
 const tasks=await planTasks(e.home,e.op('seconds',{track:'S01',generationMode:'modify',review:'保留动作'}))
 assert.deepEqual(tasks.map(task=>task.target),['seconds:S01'])
})

test('unrecorded task snapshots keep private nodes and settle completion and cancellation', async t => {
 const e = await setupModel(t), home = e.home
 const { linkStore } = await import('../server/data/workspace-links.js')
 await linkStore(home).selectProject('session-438a7a11-3984-447d-88df-16d610f8e914', e.id, e.store)
 for (const cancel of [false, true]) {
  const entered = Promise.withResolvers(), gate = Promise.withResolvers()
  const tasks = createOperationManager({ home, execute: async (_operation, { signal }) => {
   entered.resolve()
   const abort = () => gate.reject(signal.reason)
   signal.addEventListener('abort', abort, { once: true })
   try { await gate.promise; return [] } finally { signal.removeEventListener('abort', abort) }
  } })
  const task = tasks.start({ action: 'open', projectId: e.id, sessionId: 'session-438a7a11-3984-447d-88df-16d610f8e914' })
  await entered.promise
  try {
   const current = tasks.current(e.id)[0]
   assert.equal(current.status, 'running')
   current.tasks[0].nodes[0].status = 'failed'
   current.tasks[0].nodes[0].reasons.push('外部修改')
   const fresh = await tasks.get(task.id, 'session-438a7a11-3984-447d-88df-16d610f8e914')
   assert.equal(fresh.status, 'running')
   assert.equal(fresh.tasks[0].nodes[0].status, 'running')
   assert.deepEqual(fresh.tasks[0].nodes[0].reasons, [])
   if (cancel) tasks.cancel(task.id, e.id)
  } finally { gate.resolve() }
  const done = await task.done
  assert.equal(done.status, cancel ? 'cancelled' : 'completed')
  assert.equal(done.tasks[0].nodes[0].status, done.status)
  assert.deepEqual(tasks.current(e.id), [])
 }
})
