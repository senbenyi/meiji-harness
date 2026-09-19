// 职责：验证持久化任务受理、幂等、状态、索引重建和泳道选择的核心契约。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { readJson, saveJson } from '../src/database/json.js'
import { driverFile } from '../src/database/paths.js'
import { cancel, dispatch, pause, retry, submit } from '../src/worker/manager/manager.js'
import { loadDriver, saveDriver, selectNext } from '../src/worker/manager/queue.js'
import { registerSink } from '../src/worker/manager/sinks.js'
import { taskId } from '../src/worker/manager/tasks.js'
import { driveOnce } from '../src/worker/driver/driver.js'
import { createProjectStore, registerProjectSinks } from '../src/server/projects/service.js'
import { createCallToolsProjectProduction } from '../src/tools/project/production.js'
import { getJob } from '../src/worker/runner/inspect.js'
import { jobRoot } from '../src/worker/store/paths.js'
import { saveStatus } from '../src/worker/store/status.js'

const project = 'abcd1234'
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

test('project sink applies terminal task state idempotently to the bound shot', async t => fixture(t, async () => {
  const store = createProjectStore({ directorExists: async () => true })
  const projectValue = await store.change('create', { title: '项目', director: '导演' })
  await store.changeAct(projectValue.id, 'add', { title: '第一幕' })
  let value = await store.changeShot(projectValue.id, 'add', { act_index: 0, role: '', action: '镜头', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' })
  const shotId = value.acts[0].shots[0].id, disposers = []
  registerProjectSinks({ effect: run => disposers.push(run()) }, store)
  try {
    const input = request('bound')
    input.project_id = projectValue.id
    input.lane.id = `project-${projectValue.id}-main`
    input.tasks[0].binding = { type: 'shot', shot_id: shotId }
    const accepted = await submit(input)
    await cancel(accepted.tasks[0].task_id)
    await driveOnce()
    value = await store.read(projectValue.id)
    assert.equal(value.acts[0].shots[0].job_id, accepted.tasks[0].task_id)
    assert.equal(value.acts[0].shots[0].status, 'cancelled')
  } finally { for (const dispose of disposers.reverse()) dispose() }
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
