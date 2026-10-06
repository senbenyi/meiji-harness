import test from 'node:test'
import assert from 'node:assert/strict'
import { createQueue } from '../server/flow/tasks/task-queue.js'
import { taskRegistry } from '../server/flow/tasks/task-registry.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('队列定义属于单步职责，即时保存不占名额', () => {
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

test('ffmpeg startup check reports a missing binary instead of throwing', async () => {
  const { ffmpegAvailable } = await import('../server/media/check-ffmpeg.js')
  const { EventEmitter } = await import('node:events')
  const child = (event, value) => () => { const c = new EventEmitter(); setImmediate(() => c.emit(event, value)); return c }
  assert.equal(await ffmpegAvailable(child('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))), false)
  assert.equal(await ffmpegAvailable(child('close', 0)), true)
  assert.equal(await ffmpegAvailable(child('close', 1)), false)
})
