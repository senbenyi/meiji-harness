// 职责：用本地供应商替身验证三方提交、原任务恢复、媒体持久化和自有优先。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/utils/config.js'
import { resolveGenerationBackend, thirdPartyModels, validateBackend } from '../src/servers/runtime/index.js'
import { executeJob, validatePlan } from '../src/servers/providers/byteplus/execution.js'
import { bytePlusBackend } from '../src/servers/providers/byteplus/config.js'
import { saveJson } from '../src/business/jobs/store.js'
import { openLocalMedia } from '../src/business/assets/local-media.js'
import { createJob } from '../src/business/jobs/create.js'
import { launch } from '../src/business/video/launcher.js'
import { waitJob } from '../src/business/jobs/wait.js'

const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'elysium-byteplus-')), calls = []
  let downloadFails = false, generationFails = false
  const server = createServer(async (req, res) => {
    if (req.url === '/video.mp4') {
      if (downloadFails) { res.writeHead(503); return res.end() }
      res.setHeader('Content-Type', 'video/mp4')
      return res.end(video)
    }
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push({ url: req.url, method: req.method, body: body && JSON.parse(body), auth: req.headers.authorization })
    assert.equal(req.headers.authorization, 'Bearer secret')
    if (generationFails) { res.writeHead(503); return res.end('{}') }
    const origin = `http://127.0.0.1:${server.address().port}`
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.method === 'POST' && req.url.includes('/tasks') ? { id: 'remote-task' }
      : { id: 'remote-task', status: 'succeeded', content: { video_url: origin + '/video.mp4' }, duration: 5 }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = join(root, 'byteplus.json')
  const config = { enabled: true, base_url: `http://127.0.0.1:${server.address().port}/api/v3`, api_key: 'secret', video: { model: 'video-test', duration: 5, resolution: '720p', ratio: '9:16', generate_audio: true, watermark: false } }
  await saveJson(file, config)
  const runtime = { ELYSIUM_STATE_ROOT: root, ELYSIUM_BYTEPLUS_FILE: file, COMFYUI_URL: 'http://127.0.0.1:9999', ELYSIUM_SERVERS_FILE: join(root, 'absent.json') }
  await mkdir(join(root, 'projects', 'aaaaaaaa', 'media'), { recursive: true })
  await saveJson(join(root, 'projects', 'aaaaaaaa', 'project.json'), { id: 'aaaaaaaa', title: 'test', profile: 'preview', created_at: 1, updated_at: 1 })
  await Promise.all(['anchors', 'materials', 'storyboard', 'deliverables'].map(name => saveJson(join(root, 'projects', 'aaaaaaaa', name + '.json'), [])))
  return { root, calls, runtime, config, file, bind: action => withConfig(runtime, action), failDownload: value => { downloadFails = value }, failGeneration: value => { generationFails = value }, close: async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) } }
}

test('own connected video wins; unavailable own video falls back; model listing never exposes keys', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    assert.equal((await resolveGenerationBackend('video', { probe: async () => true })).provider, 'manual')
    assert.equal((await resolveGenerationBackend('video', { probe: async () => false })).provider, 'byteplus')
    const models = await thirdPartyModels()
    assert.equal(models.video[0].label, 'Seedance 2.0'); assert.doesNotMatch(JSON.stringify(models), /secret|api_key/)
    assert.equal(f.calls.length, 0)
    const original = bytePlusBackend('video')
    f.config.video.model = 'changed-model'; await saveJson(f.file, f.config)
    await validateBackend(original)
    assert.equal(original.connection.model, 'video-test')
  }) } finally { await f.close() }
})

test('video POSTs once, polls original remote ID and downloads locally; unknown submission cannot be repeated', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    const backend = bytePlusBackend('video'), plan = { mode: 't2va', prompt: '短片', profile: 'preview' }, id = '3'.repeat(32)
    const status = await executeJob('aaaaaaaa', id, plan, backend)
    assert.equal(status.result.remote_task_id, 'remote-task')
    assert.equal(f.calls[0].body.generate_audio, true)
    assert.equal(f.calls[0].body.resolution, '720p')
    await executeJob('aaaaaaaa', id, plan, backend)
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
    assert.ok(f.calls.filter(call => call.method === 'GET').every(call => call.url.endsWith('/remote-task')))
    const media = await openLocalMedia(status)
    assert.deepEqual(await media.handle.readFile(), video); await media.handle.close()
    f.failGeneration(true)
    await assert.rejects(executeJob('aaaaaaaa', '4'.repeat(32), plan, backend))
    const count = f.calls.length
    await assert.rejects(executeJob('aaaaaaaa', '4'.repeat(32), plan, backend), /结果未知/)
    assert.equal(f.calls.length, count)
    assert.throws(() => validatePlan({ ...plan, duration_seconds: 3 }, backend), /4至15/)
    assert.throws(() => validatePlan({ ...plan, mode: 'i2va', first_frame: 'http://localhost/private.png' }, backend), /图片引用/)
  }) } finally { await f.close() }
})

test('missing credentials fail before writing a paid submission journal', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    const backend = bytePlusBackend('video')
    f.config.api_key = ''; await saveJson(f.file, f.config)
    await assert.rejects(executeJob('aaaaaaaa', '5'.repeat(32), { mode: 't2va', prompt: 'test' }, backend), /api_key/)
    assert.equal(f.calls.length, 0)
    assert.equal((await readdir(join(f.root, 'projects', 'aaaaaaaa'))).includes('jobs'), false)
  }) } finally { await f.close() }
})

test('real worker receives environment config and uses the saved video backend', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    const backend = bytePlusBackend('video'), id = await createJob('aaaaaaaa', { mode: 't2va', prompt: '环境配置视频' }, backend)
    const result = await waitJob(await launch(id, 'workflow-video'), undefined)
    assert.equal(result.status, 'succeeded'); assert.equal(result.media_kind, 'video')
  }) } finally { await f.close() }
})
