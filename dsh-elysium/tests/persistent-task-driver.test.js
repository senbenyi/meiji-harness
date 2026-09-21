// 职责：验证持久化任务受理、幂等、状态、索引重建和泳道选择的核心契约。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { readJson, saveJson } from '../src/database/json.js'
import { driverFile } from '../src/database/paths.js'
import { cancel, dispatch, pause, retry, submit } from '../src/worker/manager/manager.js'
import { loadDriver, saveDriver, selectNext } from '../src/worker/manager/queue.js'
import { registerSink } from '../src/worker/manager/sinks.js'
import { readTask, taskId } from '../src/worker/manager/tasks.js'
import { driveOnce } from '../src/worker/driver/driver.js'
import { createProjectStore, registerProjectSinks } from '../src/server/projects/service.js'
import { createCallToolsProjectProduction } from '../src/tools/project/production.js'
import { getJob } from '../src/worker/runner/inspect.js'
import { jobRoot } from '../src/worker/store/paths.js'
import { saveStatus } from '../src/worker/store/status.js'
import { heartbeatStale } from '../src/worker/runner/heartbeat.js'
import { job, seedProject, writeJob } from './fixtures/drama.mjs'

const project = 'abcd1234'
const cover = 'f'.repeat(32)
const coverOptions = { readJob: async job_id => ({ job_id, status: 'succeeded' }), summarizeJob: async () => ({ has_image: true }), directorExists: async () => true }
const request = prompt => ({ submission_id: 'batch-fixed-001', lane: { id: 'project-abcd1234-main', priority: 'batch' }, project_id: project,
  tasks: [{ kind: 'video', plan: { mode: 't2va', prompt } }], channel: 'test' })

async function fixture(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'persistent-driver-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return withConfig({ COMFYUI_URL: 'https://comfy.test', ELYSIUM_STATE_ROOT: root }, () => run(root))
}

test('submission is durable and idempotent, conflicts are rejected, and retry preserves seq', async t => fixture(t, async root => {
  const receipts = await Promise.all(Array.from({ length: 5 }, () => submit(request('first'))))
  const first = receipts[0]
  assert.ok(receipts.every(value => JSON.stringify(value) === JSON.stringify(first)))
  const id = taskId('batch-fixed-001', 0)
  assert.equal(first.tasks[0].task_id, id)
  assert.equal((await getJob(id)).status, 'pending')
  assert.equal((await readJson(join(jobRoot(id), 'input/origin.json'))).seq, first.tasks[0].seq)
  assert.deepEqual(await submit(request('first')), first)
  await assert.rejects(submit(request('changed')), { code: 'SUBMISSION_CONFLICT' })
  await saveStatus(jobRoot(id), { ...(await getJob(id)), status: 'failed', stage: 'failed', error_code: 'TEST', error: 'test', finished_at: new Date().toISOString() })
  const retried = await retry(id, { kind: 'video', consent: true })
  assert.equal(retried.status, 'pending')
  assert.match(await readFile(join(jobRoot(id), 'history.jsonl'), 'utf8'), /"event":"retry-queued"/)
  assert.equal((await loadDriver()).entries.find(entry => entry.task_id === id).seq, first.tasks[0].seq)
  await cancel(id)
  assert.equal((await getJob(id)).status, 'cancelled')
  assert.deepEqual((await readdir(join(root, 'projects'))).sort(), ['jobs', 'tasks'])
}))

test('a forward reference rejects the whole batch before task or job records are created', async t => fixture(t, async root => {
  const submission = 'forward-ref-001', later = taskId(submission, 1)
  const value = { submission_id: submission, lane: { id: 'project-abcd1234-main', priority: 'batch' }, project_id: project, tasks: [
    { kind: 'video', plan: { mode: 'i2va', prompt: 'first', first_frame: `job:${later}` } },
    { kind: 'video', plan: { mode: 't2va', prompt: 'later' } },
  ] }
  await assert.rejects(submit(value), { code: 'MODEL_INPUT_INVALID' })
  await assert.rejects(readdir(join(root, 'projects', 'tasks')), error => error.code === 'ENOENT')
  await assert.rejects(readdir(join(root, 'projects', 'jobs')), error => error.code === 'ENOENT')
}))

test('driver index rebuilds from task and job truth and lane selection rotates within a priority', async t => fixture(t, async () => {
  const accepted = await submit(request('rebuild'))
  await rm(driverFile(), { force: true })
  const rebuilt = await loadDriver()
  assert.ok(rebuilt.rebuilt_at)
  assert.equal(rebuilt.entries[0].task_id, accepted.tasks[0].task_id)
  const driver = { lanes: { a: { priority: 'interactive', paused: false }, b: { priority: 'interactive', paused: false }, c: { priority: 'batch', paused: false } },
    entries: [{ seq: 1, task_id: 'a'.repeat(32), lane_id: 'a' }, { seq: 2, task_id: 'b'.repeat(32), lane_id: 'b' },
      { seq: 3, task_id: 'c'.repeat(32), lane_id: 'c' }, { seq: 4, task_id: 'd'.repeat(32), lane_id: 'a' }] }
  const statuses = new Map(driver.entries.map(entry => [entry.task_id, 'pending']))
  assert.equal((await selectNext(driver, statuses)).task_id, 'a'.repeat(32))
  statuses.set('a'.repeat(32), 'queued')
  assert.equal(await selectNext(driver, statuses), null)
  statuses.set('a'.repeat(32), 'failed')
  assert.equal((await selectNext(driver, statuses)).lane_id, 'b')
  statuses.set('b'.repeat(32), 'succeeded')
  assert.equal((await selectNext(driver, statuses)).task_id, 'd'.repeat(32))
}))

test('full reconciliation repairs a missing Job and a missing driver entry', async t => fixture(t, async () => {
  const accepted = await submit(request('repair')), id = accepted.tasks[0].task_id
  await pause(accepted.lane_id)
  await rm(jobRoot(id), { recursive: true, force: true })
  let driver = await loadDriver()
  driver.entries = []
  await saveDriver(driver)
  await driveOnce({ full: true })
  assert.equal((await getJob(id)).status, 'pending')
  assert.ok((await loadDriver()).entries.some(entry => entry.task_id === id))
}))

test('one corrupt current status does not crash the driver or dispatch another task unsafely', async t => fixture(t, async () => {
  const first = await submit(request('first-corrupt'))
  const secondRequest = request('second-safe')
  secondRequest.submission_id = 'batch-fixed-002'
  const second = await submit(secondRequest)
  await writeFile(join(jobRoot(first.tasks[0].task_id), 'status.json'), '{broken')
  await assert.doesNotReject(driveOnce())
  assert.equal((await getJob(second.tasks[0].task_id)).status, 'pending')
}))

test('worker heartbeat identifies stale execution without making the heartbeat file state truth', async t => fixture(t, async root => {
  const directory = join(root, 'heartbeat-test')
  await mkdir(directory)
  assert.equal(await heartbeatStale(directory), false)
  await writeFile(join(directory, 'heartbeat.json'), JSON.stringify({ state: 'running', updated_at: Date.now() - 61_000 }))
  assert.equal(await heartbeatStale(directory), true)
  await writeFile(join(directory, 'heartbeat.json'), JSON.stringify({ state: 'stopped', updated_at: 0 }))
  assert.equal(await heartbeatStale(directory), false)
}))

test('driver records a missing current worker as failed for manual retry', async t => fixture(t, async () => {
  const accepted = await submit(request('missing-worker')), id = accepted.tasks[0].task_id
  await saveStatus(jobRoot(id), { ...(await getJob(id)), server: { provider: 'test' }, status: 'queued', stage: 'queued' })
  await saveStatus(jobRoot(id), { ...(await getJob(id)), status: 'running', stage: 'execute' })
  const failed = await getJob(id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error_code, 'WORKER_NOT_RUNNING')
  assert.match(await readFile(join(jobRoot(id), 'history.jsonl'), 'utf8'), /"event":"worker-missing"/)
}))

test('a failed dependency makes its consumer fail without launching a worker', async t => fixture(t, async () => {
  const submission = 'failed-ref-001', first = taskId(submission, 0)
  const accepted = await submit({ submission_id: submission, lane: { id: 'project-abcd1234-main', priority: 'batch' }, project_id: project, tasks: [
    { kind: 'video', plan: { mode: 't2va', prompt: 'anchor' } },
    { kind: 'video', plan: { mode: 'i2va', prompt: 'consumer', first_frame: `job:${first}` } },
  ] })
  await saveStatus(jobRoot(first), { ...(await getJob(first)), status: 'failed', stage: 'failed', error_code: 'TEST', error: 'test', finished_at: new Date().toISOString() })
  const consumer = accepted.tasks[1].task_id
  assert.equal((await dispatch(consumer)).status, 'failed')
  assert.equal((await getJob(consumer)).error_code, 'REFERENCE_FAILED')
}))

test('concurrent JSON writes use independent temporary files and leave valid JSON', async t => fixture(t, async root => {
  const path = join(root, 'runtime', 'concurrent.json')
  await Promise.all(Array.from({ length: 20 }, (_, value) => saveJson(path, { value })))
  assert.ok(Number.isInteger((await readJson(path)).value))
  assert.deepEqual((await readdir(join(root, 'runtime'))).filter(name => name.includes('.tmp')), [])
}))

test('terminal settlement is retried until the sink succeeds and then leaves the driver index', async t => fixture(t, async () => {
  const value = request('settle')
  value.tasks[0].binding = { type: 'test-sink', key: 'shot' }
  const accepted = await submit(value), id = accepted.tasks[0].task_id
  await cancel(id)
  let deliveries = 0
  const dispose = registerSink('test-sink', async () => { if (++deliveries === 1) throw new Error('temporary') })
  try {
    await driveOnce()
    assert.equal(deliveries, 1)
    assert.ok((await loadDriver()).entries.some(entry => entry.task_id === id))
    await driveOnce()
    assert.equal(deliveries, 2)
    assert.equal((await loadDriver()).entries.some(entry => entry.task_id === id), false)
    assert.equal((await readJson(join(jobRoot(id), 'settled.json'))).status, 'cancelled')
  } finally { dispose() }
}))

const autodl = { provider: 'autodl', service: 'comfyui', base_url: 'https://comfy.test', connection: { workload: 'minimax-h3' }, instance_id: 'i', deployment_id: 'd' }
async function production(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'project-production-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return withConfig({ COMFYUI_URL: autodl.base_url, ELYSIUM_BACKEND: autodl, ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore({ directorExists: async () => true }), created = await store.change('create', { title: '项目', director: '导演' })
    await seedProject(root, created.id)
    await writeJob(root, job('c'), { project_id: created.id, status: 'succeeded', result: { media_kind: 'image', comfyui_view_url: 'https://comfy.test/view?filename=c.png&type=output' } })
    const disposers = []
    registerProjectSinks({ effect: action => disposers.push(action()) }, store)
    try { return await run(store, created.id) } finally { for (const dispose of disposers.reverse()) dispose() }
  })
}

test('each shot submits a keyframe then an i2va video in one lane with fresh seeds per take and idempotent replays', async t => production(t, async (store, id) => {
  const first = (await store.produceShot({ project_id: id, episode: 1, shot_id: 's1' })).acts[0].shots[0]
  const [keyframe, video] = await Promise.all([readTask(first.keyframe_job_id), readTask(first.job_id)])
  assert.deepEqual([first.take, first.status, keyframe.lane.id, video.lane.id], [1, 'pending', `project-${id}-main`, `project-${id}-main`])
  assert.deepEqual(keyframe.binding, { type: 'keyframe', shot_id: 's1', episode: 1 })
  assert.deepEqual(keyframe.plan, { capability: 'image-generate', params: { prompt: 'a man in a kitchen', seed: keyframe.plan.params.seed, purpose: 'keyframe', image_path: `job:${job('c')}` } })
  assert.deepEqual(video.plan, { mode: 'i2va', prompt: '场景：公寓。旧厨房\n提示词 台词s1', first_frame: `job:${first.keyframe_job_id}`, duration_seconds: 5, seed: video.plan.seed })
  await assert.rejects(store.produceShot({ project_id: id, episode: 1, shot_id: 's1' }), /已有任务/)
  await assert.rejects(store.reshootShot({ project_id: id, episode: 1, shot_id: 's1' }), /正在生成/)
  await store.changeShot(id, { id: 's1', episode: 1, status: 'succeeded' })
  const reset = (await store.reshootShot({ project_id: id, episode: 1, shot_id: 's1' })).acts[0].shots[0]
  assert.deepEqual([reset.job_id, reset.keyframe_job_id, reset.status, reset.take], [null, null, 'pending', 1])
  const second = (await store.produceShot({ project_id: id, episode: 1, shot_id: 's1' })).acts[0].shots[0]
  const next = await readTask(second.keyframe_job_id)
  assert.notEqual(second.keyframe_job_id, first.keyframe_job_id)
  assert.notEqual(next.plan.params.seed, keyframe.plan.params.seed)
  await store.changeShot(id, { id: 's1', episode: 1, take: 1, job_id: null, keyframe_job_id: null })
  assert.equal((await store.produceShot({ project_id: id, episode: 1, shot_id: 's1' })).acts[0].shots[0].keyframe_job_id, second.keyframe_job_id)
  const indexed = new Set((await loadDriver()).entries.map(entry => entry.task_id))
  assert.ok([first.keyframe_job_id, first.job_id].every(item => indexed.has(item)))
}))

test('a failed keyframe fails its video without launching a worker and both sinks mark the shot failed', async t => production(t, async (store, id) => {
  const shot = (await store.produceShot({ project_id: id, episode: 1, shot_id: 's2' })).acts[0].shots[1]
  await saveStatus(jobRoot(shot.keyframe_job_id), { ...(await getJob(shot.keyframe_job_id)), status: 'failed', stage: 'failed', error_code: 'TEST', error: 'test', finished_at: new Date().toISOString() })
  await driveOnce()
  assert.equal((await getJob(shot.job_id)).error_code, 'REFERENCE_FAILED')
  await driveOnce()
  const settled = (await store.readEpisode(id, 1)).acts[0].shots[1]
  assert.deepEqual([settled.job_id, settled.status], [shot.job_id, 'failed'])
  await assert.rejects(store.retryShot({ project_id: id, episode: 1, shot_id: 's2' }), /请重拍/)
}))

test('shots wait for a ready main-character reference and finalized prompts', async t => production(t, async (store, id) => {
  await store.changeAnchor(id, 'update', { role: 'lin', image_needs_review: true })
  await assert.rejects(store.produceShot({ project_id: id, episode: 1, shot_id: 's1' }), /主角锚点图尚未就绪/)
  await store.changeAnchor(id, 'update', { role: 'lin', image_needs_review: false })
  await store.changeShot(id, { id: 's1', episode: 1, prompt_finalized: false })
  await assert.rejects(store.produceShot({ project_id: id, episode: 1, shot_id: 's1' }), /提示词尚未定稿/)
}))

test('director batch tool binds its waiter to the owning agent and cancelling the waiter keeps durable tasks', async t => fixture(t, async () => {
  let spec, hooks
  const jobs = { start(value) { spec = value; hooks = value.run(); return 'elysium-1' } }
  const tool = createCallToolsProjectProduction({ jobs })[0]
  const agent = { session: { id: 'session-one', snapshotEvents: () => [] } }
  const result = await tool.execute({ project_id: project, tasks: [{ kind: 'video', plan: { mode: 't2va', prompt: 'batch' } }] }, { agent, callId: 'call-one' })
  assert.equal(result.job_id, 'elysium-1')
  assert.equal(spec.owner, agent)
  hooks.cancel('stop waiting')
  assert.equal((await hooks.done).status, 'killed')
  assert.equal((await getJob(result.task_ids[0])).status, 'pending')
}))
