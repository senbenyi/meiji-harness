import test from 'node:test'
import assert from 'node:assert/strict'
import { createQueue } from '../server/flow/tasks/queue.js'
import { createTasks } from '../server/flow/tasks/runner.js'
import { definitions, queueOf } from '../server/flow/operations/registry.js'
import { tempHome } from './fixtures/model.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('actions map to text, image and video queues', () => {
  assert.equal(queueOf('shots'), 'text')
  assert.equal(queueOf('pencil'), 'image')
  assert.equal(queueOf('films'), 'video')
  // 只有调用图片或视频接口的操作占用 image / video 名额。
  const image = new Set(['image', 'revise-image', 'part-image', 'pencil']), video = new Set(['film', 'films', 'produce', 'produce-all', 'tail-frame'])
  for (const action of Object.keys(definitions)) assert.equal(queueOf(action), image.has(action) ? 'image' : video.has(action) ? 'video' : 'text', action)
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

test('tasks beyond the limit report queued and start when a slot frees', async t => {
  const gates = new Map(), started = []
  const tasks = createTasks({ home: await tempHome(t), limitOf: () => 1, execute: async operation => {
    started.push(operation.projectId); const gate = deferred(); gates.set(operation.projectId, gate); await gate.promise; return []
  } })
  const a = tasks.start({ action: 'films', projectId: 'a', sessionId: 's' })
  const b = tasks.start({ action: 'films', projectId: 'b', sessionId: 's' })
  await until(async () => started.length === 1 && (await tasks.get(b.id, 's')).queuePosition === 1)
  assert.deepEqual(started, ['a'])
  assert.equal((await tasks.get(b.id, 's')).queued, true)
  assert.equal((await tasks.get(b.id, 's')).status, 'queued')
  gates.get('a').resolve(); await a.done
  await until(() => started.length === 2)
  assert.deepEqual(started, ['a', 'b'])
  assert.equal((await tasks.get(b.id, 's')).queued, false)
  gates.get('b').resolve()
  assert.equal((await b.done).status, 'completed')
})

test('ffmpeg startup check reports a missing binary instead of throwing', async () => {
  const { ffmpegAvailable } = await import('../server/generate/ffmpeg.js')
  const { EventEmitter } = await import('node:events')
  const child = (event, value) => () => { const c = new EventEmitter(); setImmediate(() => c.emit(event, value)); return c }
  assert.equal(await ffmpegAvailable(child('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))), false)
  assert.equal(await ffmpegAvailable(child('close', 0)), true)
  assert.equal(await ffmpegAvailable(child('close', 1)), false)
})
