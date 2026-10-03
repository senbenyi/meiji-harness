import { operationRequest } from '../client/operation-request.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createQueue } from '../server/flow/tasks/task-queue.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { taskRegistry } from '../server/flow/tasks/task-registry.js'
import { tempHome, setupModel } from './fixtures/model.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('队列定义属于独立任务，直接保存不占名额', () => {
  assert.equal(taskRegistry['shot-table'].queue, 'text')
  assert.equal(taskRegistry['character-image'].queue, 'image')
  assert.equal(taskRegistry.video.queue, 'video')
  assert.equal(taskRegistry.save.queue, null)
})

test('waiting jobs report their queue position', async () => {
  const queue = createQueue(() => 1), gate = deferred()
  const first = queue.run('text', null, () => gate.promise, null, 'a')
  const second = queue.run('text', null, async () => {}, null, 'b')
  const third = queue.run('text', null, async () => {}, null, 'c')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queue.position('a'), null)
  assert.equal(queue.position('b'), 1)
  assert.equal(queue.position('c'), 2)
  gate.resolve()
  await Promise.all([first, second, third])
  assert.equal(queue.position('c'), null)
})

test('a kind never runs more jobs than its limit and hands freed slots to the oldest waiter', async () => {
  const queue = createQueue(() => 2), gates = [deferred(), deferred(), deferred()], order = []
  let running = 0, peak = 0
  const job = index => queue.run('video', null, async () => { running++; peak = Math.max(peak, running); order.push(index); await gates[index].promise; running-- })
  const jobs = [0, 1, 2].map(job)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [0, 1])
  assert.deepEqual(queue.stats().video, { active: 2, waiting: 1 })
  // 新任务不能抢走交接中的名额
  gates[0].resolve(); const late = queue.run('video', null, async () => { order.push('late') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [0, 1, 2])
  gates[1].resolve(); gates[2].resolve()
  await Promise.all([...jobs, late])
  assert.equal(peak, 2)
  assert.deepEqual(order, [0, 1, 2, 'late'])
  assert.deepEqual(queue.stats().video, { active: 0, waiting: 0 })
})

test('other kinds are not blocked by a full queue', async () => {
  const queue = createQueue(() => 1), gate = deferred()
  const video = queue.run('video', null, () => gate.promise)
  assert.equal(await queue.run('text', null, async () => 'text done'), 'text done')
  gate.resolve(); await video
})

test('a queued task can be cancelled before it starts', async () => {
  const queue = createQueue(() => 1), gate = deferred(), controller = new AbortController()
  let started = false
  const first = queue.run('image', null, () => gate.promise)
  const second = queue.run('image', controller.signal, async () => { started = true })
  controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
  await assert.rejects(second, { code: 'TASK_CANCELLED' })
  gate.resolve(); await first
  assert.equal(started, false)
  assert.deepEqual(queue.stats().image, { active: 0, waiting: 0 })
})

// 入队前要写任务记录，等待到条件成立（最多 2 秒）。
const until = async predicate => { for (let i = 0; i < 200 && !(await predicate()); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(await predicate()) }

test('独立任务进入对应队列，等待名额时保持剧集占用', async t => {
  const e = await setupModel(t), gates = new Map(), started = []
  const second = { ...structuredClone(e.episode), id: '22222222-2222-4222-8222-222222222222' }
  await e.store.save(e.id, root => { root.episodes.push(second); return root })
  const tasks = createOperationManager({ home: e.home, limitOf: () => 1, execute: async (op, deps) => {
    started.push(op.episodeId); const gate = deferred(); gates.set(op.episodeId, gate); await gate.promise; return []
  } })
  const a = tasks.start(e.op('shot-table', {})), b = tasks.start(e.op('shot-table', { episodeId: second.id }))
  await until(async () => started.length === 1 && (await tasks.get(b.id)).queuePosition === 1)
  assert.equal((await tasks.get(b.id)).status, 'queued')
  assert.equal(tasks.current(e.id, e.episodeId).length, 1)
  assert.equal(tasks.current(e.id, second.id).length, 1)
  assert.ok(tasks.current(e.id, e.episodeId)[0].tasks[0].startedAt)
  assert.throws(() => tasks.start(e.op('seconds', { episodeId: second.id })), { status: 409 })
  gates.get(e.episodeId).resolve(); await a.done
  await until(() => started.length === 2)
  gates.get(second.id).resolve(); assert.equal((await b.done).status, 'completed')
})

test('ffmpeg startup check reports a missing binary instead of throwing', async () => {
  const { ffmpegAvailable } = await import('../server/media/check-ffmpeg.js')
  const { EventEmitter } = await import('node:events')
  const child = (event, value) => () => { const c = new EventEmitter(); setImmediate(() => c.emit(event, value)); return c }
  assert.equal(await ffmpegAvailable(child('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))), false)
  assert.equal(await ffmpegAvailable(child('close', 0)), true)
  assert.equal(await ffmpegAvailable(child('close', 1)), false)
})
