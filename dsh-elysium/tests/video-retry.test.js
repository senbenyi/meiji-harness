import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig, requiredConfig } from '../src/utils/config.js'
import { ComfyClient } from '../src/comfyui/client.js'
import { executeComfyVideo as executePinnedVideo } from '../src/business/video/execution.js'
import { buildBackendGraph } from '../src/servers/runtime/index.js'
const buildVideoGraph = (plan, id) => buildBackendGraph({ provider: 'manual', legacy: true, service: 'comfyui', base_url: 'https://comfy.test' }, plan, id)
import { startVideoJob, resumeVideoJob } from '../src/business/video/service.js'
import { createJob } from '../src/business/jobs/create.js'
import { bindVideoCall, findVideoCall } from '../src/business/video/call-binding.js'
import { readJson, saveJson } from '../src/business/jobs/store.js'
import { userRequestedVideoRetry } from '../src/harness/video.js'

async function executeComfyVideo(projectId, jobId, plan, options) {
  await saveJson(join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects', projectId, 'jobs', jobId, 'input/backend.json'), { server_id: 'minimax-h3', provider: 'manual', legacy: true, service: 'comfyui', base_url: 'https://comfy.test' })
  return executePinnedVideo(projectId, jobId, plan, options)
}

const plan = { mode: 't2va', prompt: 'A woman cooking in a kitchen.' }
const project = 'abcd1234'
const retryExec = text => ({ agent: { session: { snapshotEvents: () => [
  { type: 'turn/start', data: { turn: 2 } },
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } },
] } } })
async function fixture(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'video-retry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'projects', project), { recursive: true })
  await writeFile(join(root, 'projects', project, 'project.json'), '{}')
  return withConfig({ COMFYUI_URL: 'https://comfy.test', ELYSIUM_STATE_ROOT: root }, () => run(root))
}

test('prepare, lost POST response and polling recover inside one job with exactly one submission', async t => fixture(t, async root => {
  const id = 'a'.repeat(32), delays = []
  const { outputNode } = await buildVideoGraph(plan, id)
  let validation = 0, posts = 0, polls = 0
  t.mock.method(ComfyClient.prototype, 'validate', async () => {
    if (++validation <= 2) throw new TypeError('fetch failed')
  })
  t.mock.method(ComfyClient.prototype, 'request', async route => {
    if (route === 'prompt') { posts++; throw new TypeError('fetch failed') }
    if (route === 'queue') return { queue_running: [[0, 'original', {}, { elysium_job_id: id }]] }
    if (route === 'history') return {}
    assert.equal(route, 'history/original')
    if (++polls === 1) throw new DOMException('timeout', 'TimeoutError')
    return { original: { status: { completed: true }, outputs: { [outputNode]: { videos: [{ filename: 'final.mp4', type: 'output' }] } } } }
  })
  const result = await executeComfyVideo(project, id, plan, { pause: async ms => {
    delays.push(ms)
    assert.equal((await readJson(join(root, 'projects', project, 'jobs', id, 'status.json'))).stage, 'reconnecting')
  } })
  assert.equal(result.status, 'succeeded')
  assert.equal(result.result.comfyui_prompt_id, 'original')
  assert.equal(posts, 1)
  assert.deepEqual(delays, [2000, 4000, 8000, 16000])
  assert.equal(result.timings.clock, 'performance.now')
  assert.equal(result.timings.stages['reconnect.backoff'].count, 4)
  assert.equal(result.timings.stages['prepare.validate'].failed, 2)
  assert.deepEqual(await readdir(join(root, 'projects', project, 'jobs')), [id])
}))

test('persistent outage stops after five retries without submission or new jobs', async t => fixture(t, async root => {
  let attempts = 0
  t.mock.method(ComfyClient.prototype, 'validate', async () => { attempts++; throw new TypeError('fetch failed') })
  t.mock.method(ComfyClient.prototype, 'submit', () => assert.fail('must not submit'))
  const id = 'b'.repeat(32), delays = []
  await assert.rejects(executeComfyVideo(project, id, plan, { pause: async ms => delays.push(ms) }), /fetch failed/)
  const status = await readJson(join(root, 'projects', project, 'jobs', id, 'status.json'))
  assert.equal(attempts, 6)
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000])
  assert.equal(status.status, 'failed')
  assert.equal(status.timings.stages['reconnect.backoff'].count, 5)
  assert.match(status.recovery_instruction, /等待用户/)
  assert.deepEqual(await readdir(join(root, 'projects', project, 'jobs')), [id])
}))

test('video recovery requires an explicit retry request from the current user turn', () => {
  assert.equal(userRequestedVideoRetry(retryExec('请重试刚才的视频')), true)
  assert.equal(userRequestedVideoRetry(retryExec('继续恢复原任务')), true)
  assert.equal(userRequestedVideoRetry(retryExec('生成一个新视频')), false)
  assert.equal(userRequestedVideoRetry(retryExec('不要自动重试')), false)
  assert.equal(userRequestedVideoRetry({ agent: { session: { snapshotEvents: () => [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '重试' }] } },
  ] } } }), false)
})

test('cancellation during backoff stops the same job immediately', async t => fixture(t, async root => {
  const controller = new AbortController(), id = 'c'.repeat(32)
  let attempts = 0
  t.mock.method(ComfyClient.prototype, 'validate', async () => { attempts++; throw new TypeError('fetch failed') })
  await assert.rejects(executeComfyVideo(project, id, plan, { signal: controller.signal, pause: async () => {
    controller.abort(); throw controller.signal.reason
  } }), { name: 'AbortError' })
  assert.equal(attempts, 1)
  assert.equal((await readJson(join(root, 'projects', project, 'jobs', id, 'status.json'))).status, 'failed')
}))

test('changed prompt and concurrent repeat calls reuse the failed job; repeated resume in one turn cannot relaunch', async t => fixture(t, async root => {
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'first' } }]
  const session = { id: 'session', snapshotEvents: () => events }
  const exec = callId => ({ agent: { session }, callId })
  const id = await createJob(project, plan)
  await bindVideoCall(id, exec('first'))
  await saveJson(join(root, 'projects', project, 'jobs', id, 'status.json'), { job_id: id, project_id: project, capability: 'workflow-video', backend: 'comfyui', status: 'failed' })
  const repeated = await Promise.all(['second', 'third'].map(callId => startVideoJob({ project_id: project, ...plan, prompt: 'Changed by the model.' }, exec(callId))))
  assert.ok(repeated.every(job => job.job_id === id))
  assert.equal(await findVideoCall(session.id, 'second'), id)
  events.push({ type: 'tool/call', data: { name: 'workflow_resume_video', callId: 'resume' } })
  await bindVideoCall(id, exec('resume'))
  assert.equal((await resumeVideoJob(id, exec('repeat-resume'))).job_id, id)
  assert.deepEqual(await readdir(join(root, 'projects', project, 'jobs')), [id])
  assert.equal(await readJson(join(root, 'projects', project, 'jobs', id, 'worker.lock')), null)
}))

test('a repeated generation call in the same user turn reuses the succeeded video', async t => fixture(t, async root => {
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'first' } }]
  const session = { id: 'session', snapshotEvents: () => events }
  const exec = callId => ({ agent: { session }, callId })
  const id = await createJob(project, plan)
  await bindVideoCall(id, exec('first'))
  await saveJson(join(root, 'projects', project, 'jobs', id, 'status.json'), { job_id: id, project_id: project, capability: 'workflow-video', status: 'succeeded' })

  const repeated = await startVideoJob({ project_id: project, ...plan, prompt: 'Changed by the model.' }, exec('second'))

  assert.equal(repeated.job_id, id)
  assert.deepEqual(await readdir(join(root, 'projects', project, 'jobs')), [id])
}))

test('HTTP gateway failures are retryable even when the response is HTML; validation failures are not retried', async t => fixture(t, async () => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 502 }))
  await assert.rejects(new ComfyClient().request('object_info/CLIPLoader'), { status: 502 })
  let validation = 0
  t.mock.method(ComfyClient.prototype, 'validate', async () => { validation++; throw new Error('invalid graph') })
  await assert.rejects(executeComfyVideo(project, 'd'.repeat(32), plan, { pause: () => assert.fail('validation errors must stop') }), /invalid graph/)
  assert.equal(validation, 1)
}))
