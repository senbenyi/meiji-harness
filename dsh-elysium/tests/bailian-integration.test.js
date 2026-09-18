// 职责：验证百炼选择、真实子进程执行、多镜头参考帧及原任务恢复不重复付费。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/utils/config.js'
import { resolveGenerationBackend, thirdPartyModels, thirdPartyChannels } from '../src/servers/runtime/index.js'
import { bailianBackend } from '../src/servers/providers/bailian/config.js'
import { executeJob, validatePlan } from '../src/servers/providers/bailian/execution.js'
import { saveJson, readJson } from '../src/business/jobs/store.js'
import { projectJobRoot } from '../src/business/jobs/paths.js'
import { openLocalMedia } from '../src/business/assets/local-media.js'
import { createJob } from '../src/business/jobs/create.js'
import { launch } from '../src/business/video/launcher.js'
import { waitJob } from '../src/business/jobs/wait.js'
import { createServerHandler } from '../src/http/server-routes.js'

const plan = { mode: 't2va', prompt: '清晨的海边', profile: 'regular' }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-bailian-')), calls = []
  const controls = { downloadFails: false, postStatus: 200, taskStatus: 'SUCCEEDED', video: Buffer.from('video-fixture') }
  const server = createServer(async (req, res) => {
    if (req.url === '/video.mp4') { res.writeHead(controls.downloadFails ? 503 : 200, { 'Content-Type': 'video/mp4' }); return res.end(controls.video) }
    let body = ''; for await (const chunk of req) body += chunk
    calls.push({ url: req.url, method: req.method, body: body && JSON.parse(body), headers: req.headers })
    assert.equal(req.headers.authorization, 'Bearer fake-secret')
    if (req.method === 'POST') {
      assert.equal(req.headers['x-dashscope-async'], 'enable')
      assert.equal(req.url, '/api/v1/services/aigc/video-generation/video-synthesis')
      res.writeHead(controls.postStatus, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ output: { task_id: 'remote-task', task_status: 'PENDING' } }))
    }
    assert.equal(req.url, '/api/v1/tasks/remote-task')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ output: { task_id: 'remote-task', task_status: controls.taskStatus, video_url: `http://127.0.0.1:${server.address().port}/video.mp4` } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const file = join(root, 'bailian.json')
  const bytePlusFile = join(root, 'byteplus.json')
  const config = { enabled: true, api_key: 'fake-secret', base_url: `http://127.0.0.1:${server.address().port}/api/v1`, video: { text_model: 'wan2.6-t2v', image_model: 'wan2.6-i2v', duration: 5, resolution: '720P', ratio: '9:16', prompt_extend: false, watermark: false } }
  await saveJson(file, config)
  await saveJson(bytePlusFile, { enabled: true, base_url: 'https://old.test/api/v3', api_key: 'old-secret', video: { model: 'seedance', duration: 5, resolution: '720p', ratio: '9:16', generate_audio: true, watermark: false } })
  const runtime = { ELYSIUM_STATE_ROOT: root, ELYSIUM_BAILIAN_FILE: file, ELYSIUM_BYTEPLUS_FILE: bytePlusFile, ELYSIUM_SERVERS_FILE: join(root, 'absent.json'), COMFYUI_URL: 'http://127.0.0.1:1' }
  await saveJson(join(root, 'projects/aaaaaaaa/project.json'), { id: 'aaaaaaaa', title: 'test', profile: 'regular', created_at: 1, updated_at: 1 })
  for (const name of ['anchors', 'materials', 'storyboard', 'deliverables']) await saveJson(join(root, `projects/aaaaaaaa/${name}.json`), [])
  return { root, file, bytePlusFile, config, runtime, controls, calls, bind: action => withConfig(runtime, action) }
}

test('private wins; Bailian is the first third-party video channel; disabled Seedance is retained and never selected', async t => {
  const f = await fixture(t)
  await f.bind(async () => {
    assert.equal((await resolveGenerationBackend('video', { probe: async () => true })).provider, 'manual')
    assert.equal((await resolveGenerationBackend('video', { probe: async () => false })).provider, 'bailian')
    f.config.enabled = false; await saveJson(f.file, f.config)
    assert.equal((await resolveGenerationBackend('video', { probe: async () => false })).provider, 'byteplus')
    await saveJson(f.bytePlusFile, { enabled: false })
    assert.equal((await resolveGenerationBackend('video')).provider, 'manual')
    f.config.enabled = true; await saveJson(f.file, f.config)
    assert.deepEqual((await thirdPartyModels()).video.map(model => model.id), ['bailian:wan26'])
    const channels = await thirdPartyChannels()
    assert.equal(channels[0].preferred, true); assert.equal(channels[1].enabled, false)
    assert.doesNotMatch(JSON.stringify(channels), /secret|api_key|base_url/)
    assert.equal(f.calls.length, 0)
  })
})

test('download failure resumes the pinned task even after the channel is disabled; changed input cannot resubmit', async t => {
  const f = await fixture(t)
  await f.bind(async () => {
    const backend = bailianBackend('video'), id = '1'.repeat(32)
    f.controls.downloadFails = true
    await assert.rejects(executeJob('aaaaaaaa', id, plan, backend), /下载失败/)
    assert.deepEqual(f.calls[0].body, { model: 'wan2.6-t2v', input: { prompt: plan.prompt }, parameters: { duration: 5, prompt_extend: false, watermark: false, size: '720*1280' } })
    f.config.enabled = false; f.config.video.resolution = '1080P'; await saveJson(f.file, f.config)
    f.controls.downloadFails = false
    const status = await executeJob('aaaaaaaa', id, plan, backend)
    assert.equal(status.status, 'succeeded'); assert.equal(status.result.specification.resolution, '720P')
    const media = await openLocalMedia(status); assert.deepEqual(await media.handle.readFile(), f.controls.video); await media.handle.close()
    await assert.rejects(executeJob('aaaaaaaa', id, { ...plan, prompt: 'different' }, backend), /参数不一致/)
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
    assert.doesNotMatch(await readFile(join(projectJobRoot('aaaaaaaa', id), 'status.json'), 'utf8'), /fake-secret/)
  })
})

test('unknown submission, explicit rejection and failed remote task never create a second paid request', async t => {
  const f = await fixture(t)
  await f.bind(async () => {
    const backend = bailianBackend('video')
    for (const [id, http, expected] of [['2', 503, /结果未知/], ['3', 401, /被拒绝/], ['4', 200, /FAILED/]]) {
      f.controls.postStatus = http; f.controls.taskStatus = 'FAILED'
      await assert.rejects(executeJob('aaaaaaaa', id.repeat(32), plan, backend))
      const posts = f.calls.filter(call => call.method === 'POST').length
      await assert.rejects(executeJob('aaaaaaaa', id.repeat(32), plan, backend), expected)
      assert.equal(f.calls.filter(call => call.method === 'POST').length, posts)
    }
  })
})

test('unsupported modes, extra references and invalid durations fail before submission', async t => {
  const f = await fixture(t)
  await f.bind(async () => {
    const backend = bailianBackend('video')
    for (const value of [{ ...plan, mode: 'r2va' }, { ...plan, duration_seconds: 1 }, { ...plan, duration_seconds: 2.5 }, { ...plan, last_frame: 'https://example.test/a.png' }, { ...plan, mode: 'i2va', first_frame: 'asset://old' }]) assert.throws(() => validatePlan(value, backend))
    validatePlan({ ...plan, duration_seconds: 2 }, backend); validatePlan({ ...plan, duration_seconds: 15 }, backend)
    f.config.api_key = ''; await saveJson(f.file, f.config)
    await assert.rejects(executeJob('aaaaaaaa', '5'.repeat(32), plan, backend), /api_key/)
    assert.equal(await readJson(join(projectJobRoot('aaaaaaaa', '5'.repeat(32)), 'bailian-submission.json')), null)
    assert.equal(f.calls.length, 0)
  })
})

test('worker receives independent config and saved backend', async t => {
  const f = await fixture(t)
  const sample = join(f.root, 'sample.mp4')
  const encoded = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=2:d=1', '-pix_fmt', 'yuv420p', sample], { encoding: 'utf8' })
  assert.equal(encoded.status, 0, encoded.stderr); f.controls.video = await readFile(sample)
  await f.bind(async () => {
    const id = await createJob('aaaaaaaa', plan, bailianBackend('video'))
    const status = await waitJob(await launch(id, 'workflow-video'))
    assert.equal(status.status, 'succeeded', status.error); assert.equal(status.media_kind, 'video')
  })
})

test('HTTP model settings expose both channel switches without credentials or supplier calls', async t => {
  const f = await fixture(t)
  const handler = createServerHandler({ token: 't' })
  const web = createServer((req, res) => f.bind(() => handler(req, res)))
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${web.address().port}/plugins/dsh-elysium/server/models?t=t`)
    assert.equal(response.status, 200)
    const text = await response.text(), value = JSON.parse(text)
    assert.deepEqual(value.third_party.video.map(model => model.id), ['bailian:wan26', 'byteplus:seedance2'])
    assert.equal(value.third_party_selected.video, 'bailian:wan26')
    assert.doesNotMatch(text, /fake-secret|old-secret|api_key|base_url/)
    const selected = await fetch(`http://127.0.0.1:${web.address().port}/plugins/dsh-elysium/server/third-party-select?t=t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'video', id: 'byteplus:seedance2', revision: 0 }) })
    assert.equal(selected.status, 200)
    assert.equal((await f.bind(() => resolveGenerationBackend('video', { probe: async () => true }))).provider, 'manual')
    assert.equal((await f.bind(() => resolveGenerationBackend('video', { probe: async () => false }))).provider, 'byteplus')
    assert.equal(f.calls.length, 0)
  } finally { await new Promise(resolve => web.close(resolve)) }
})
