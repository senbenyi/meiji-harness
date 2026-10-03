import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTasks } from '../server/flow/tasks/task-manager.js'
import { subscribeProject } from '../server/data/project-events.js'
import { setupModel, tempHome } from './fixtures/model.js'
import { sessionForLog } from '../server/host/session-log.js'

const operation = { projectId: 'p', episodeId: 'e', action: 'seconds' }
test('button tasks execute directly with isolated logs, reject duplicates and release after cancellation', async t => {
 const events = [], session = { append: (type, data) => events.push({ type, data }) }
 let signal
 const tasks = createTasks({ home: await tempHome(t), execute: async (op, deps) => {
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
 assert.ok(events.some(e => e.data.text?.includes('任务已停止')))
})

test('failed log writes do not fail successful tasks; errors settle and release tasks', async t => {
 const home = await tempHome(t)
 const tasks = createTasks({ home, execute: async () => ['已保存'] })
 await tasks.start(operation, { append() { throw new Error('disconnected') } }).done
 assert.deepEqual(tasks.list('p'), [])
 const failed = createTasks({ home, execute: async () => { throw new Error('API failed') } })
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
 const { runOperation } = await import('../server/flow/operations/run-operation.js')
 const { generateAllSeconds } = await import('../server/flow/operations/shot-operations.js')
 const { modelStore } = await import('../server/data/model-settings.js')
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 const events = [], session = { append: (type, data) => events.push({ type, data }) }
 const tasks = createTasks({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
  generateAllSeconds: options => generateAllSeconds({ ...options, request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message) }),
 }) })
 const task = tasks.start(e.op('seconds'), session)
 await task.done
 let shot = (await e.read()).shots.items[0]
 assert.equal(shot.seconds.content.beats[0].action, '第一镜新动作')
 assert.equal(shot.seconds.status, 'passed')
 assert.equal(shot.seconds.operation, null)
 let entered
 const started = new Promise(resolve => { entered = resolve })
 const cancellable = createTasks({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
  generateAllSeconds: async () => {
   entered()
   await new Promise((resolve, reject) => deps.signal.addEventListener('abort', () => reject(deps.signal.reason), { once: true }))
  },
 }) })
 const pending = cancellable.start(e.op('seconds'), session)
 await started
 assert.equal((await e.read()).shots.seconds.operation.id, pending.id)
 cancellable.cancel(pending.id, e.id)
 await pending.done
 shot = { seconds: (await e.read()).shots.seconds }
 assert.equal(shot.seconds.status, 'failed')
 assert.equal(shot.seconds.operation, null)
 assert.equal((await e.read()).activity, null)
 assert.ok(events.every(e => e.type.startsWith('command/')))
})
test('single-shot seconds submissions are rejected at the panel boundary',()=>{
 const tasks=createTasks({home:'/tmp/tasks',execute:()=>assert.fail('must not execute')})
 assert.throws(()=>tasks.start({projectId:'p',episodeId:'e',action:'shot-seconds',track:'S01'}),/卡片集顶部统一提交/)
})

test('unrecorded task snapshots keep private steps and settle completion and cancellation', async t => {
 const home = await tempHome(t)
 for (const cancel of [false, true]) {
  const entered = Promise.withResolvers(), gate = Promise.withResolvers()
  const tasks = createTasks({ home, execute: async (_operation, { signal }) => {
   entered.resolve()
   const abort = () => gate.reject(signal.reason)
   signal.addEventListener('abort', abort, { once: true })
   try { await gate.promise; return [] } finally { signal.removeEventListener('abort', abort) }
  } })
  const task = tasks.start({ action: 'open', projectId: 'p', sessionId: 's' })
  await entered.promise
  try {
   const current = tasks.current('p')[0]
   assert.equal(current.status, 'running')
   current.steps[0].status = 'failed'
   current.steps[0].reasons.push('外部修改')
   const fresh = await tasks.get(task.id, 's')
   assert.equal(fresh.status, 'running')
   assert.equal(fresh.steps[0].status, 'running')
   assert.deepEqual(fresh.steps[0].reasons, [])
   if (cancel) tasks.cancel(task.id, 'p')
  } finally { gate.resolve() }
  const done = await task.done
  assert.equal(done.status, cancel ? 'cancelled' : 'completed')
  assert.equal(done.steps[0].status, done.status)
  assert.deepEqual(tasks.current('p'), [])
 }
})
