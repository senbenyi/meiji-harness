// 职责：验证任务管理器对图片与视频执行同一套复用与恢复策略。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { saveJson } from '../src/database/json.js'
import { submitTask, retryTask } from '../src/worker/manager/manager.js'
import { bindJobCall } from '../src/worker/intake/calls.js'

const project = 'abcd1234'
const imageId = 'e'.repeat(32), videoId = 'f'.repeat(32)

async function fixture(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'task-manager-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'projects', project), { recursive: true })
  await writeFile(join(root, 'projects', project, 'project.json'), '{}')
  const job = (id, capability, status) => saveJson(join(root, 'projects', project, 'jobs', id, 'status.json'), { job_id: id, project_id: project, capability, backend: 'comfyui', status })
  return withConfig({ COMFYUI_URL: 'https://comfy.test', ELYSIUM_STATE_ROOT: root }, () => run({ root, job }))
}

const session = (...events) => ({ id: 'session', snapshotEvents: () => events })
const exec = (value, callId) => ({ agent: { session: value }, callId })

test('images follow the video reuse rule: failed or same-turn results are reused, earlier successes are not', async t => fixture(t, async ({ root, job }) => {
  const current = session({ type: 'turn/start', data: { turn: 1 } }, { type: 'tool/call', data: { name: 'call_tools_image', callId: 'first' } })
  await job(imageId, 'workflow-image', 'failed')
  await bindJobCall(imageId, exec(current, 'first'))
  assert.equal((await submitTask('image', { project_id: project, prompt: 'changed' }, exec(current, 'again'))).job_id, imageId)
  await job(imageId, 'workflow-image', 'succeeded')
  assert.equal((await submitTask('image', { project_id: project, prompt: 'changed' }, exec(current, 'same-turn'))).job_id, imageId)
  assert.deepEqual(await readdir(join(root, 'projects', project, 'jobs')), [imageId])
  const later = session({ type: 'tool/call', data: { name: 'call_tools_image', callId: 'first' } }, { type: 'turn/start', data: { turn: 2 } })
  // 上一轮已成功的图片不复用：进入路由（本夹具未配置图片模型）。
  await assert.rejects(submitTask('image', { project_id: project, prompt: 'next' }, exec(later, 'next')), /未配置图片模型/)
}))

test('recovery requires consent and a matching task kind; succeeded tasks are returned without relaunch', async t => fixture(t, async ({ root, job }) => {
  await job(imageId, 'workflow-image', 'failed')
  await job(videoId, 'workflow-video', 'succeeded')
  await assert.rejects(retryTask(imageId, { kind: 'image' }), { code: 'MODEL_RETRY_CONFIRMATION_REQUIRED' })
  await assert.rejects(retryTask(imageId, { kind: 'video', consent: true }), { code: 'MODEL_INPUT_INVALID' })
  assert.deepEqual(await retryTask(videoId, { consent: true }), { job_id: videoId, project_id: project, status: 'succeeded' })
  await assert.rejects(readdir(join(root, 'projects', project, 'jobs', videoId, 'worker.lock')))
}))

test('submission validates the task kind, project and new_task flag before routing', async t => fixture(t, async () => {
  await assert.rejects(submitTask('audio', { project_id: project, prompt: 'x' }), { code: 'MODEL_INPUT_INVALID' })
  await assert.rejects(submitTask('image', { project_id: 'bad', prompt: 'x' }), { code: 'MODEL_INPUT_INVALID' })
  await assert.rejects(submitTask('video', { project_id: project, prompt: 'x', new_task: 'yes' }), { code: 'MODEL_INPUT_INVALID' })
}))
