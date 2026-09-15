// 职责：用本地供应商替身验证三方提交、原任务恢复、媒体持久化和自有优先。
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { runProduction } from '../../../../business/production/runner.js'
import { validateProductionManifest } from '../../../../business/production/manifest.js'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../../../../config.js'
import { resolveGenerationBackend, thirdPartyModels, providerFor } from '../../../runtime/index.js'
import { executeJob, validatePlan } from '../execution.js'
import { bytePlusBackend } from '../config.js'
import { saveJson } from '../../../../business/jobs/store.js'
import { projectJobRoot } from '../../../../business/jobs/paths.js'
import { openLocalMedia } from '../../../../business/assets/local-media.js'
import { listAssets } from '../../../../business/assets/catalog.js'
import { createMediaHandler } from '../../../../http/media-routes.js'
import { createProjectHandler } from '../../../../http/project-routes.js'
import { createJob } from '../../../../business/jobs/create.js'
import { launch } from '../../../../business/video/launcher.js'
import { waitJob } from '../../../../business/jobs/wait.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')
const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'elysium-byteplus-')), calls = []
  let downloadFails = false, generationFails = false, videoBytes = video
  const server = createServer(async (req, res) => {
    if (req.url === '/image.png' || req.url === '/video.mp4') {
      if (downloadFails) { res.writeHead(503); return res.end() }
      res.setHeader('Content-Type', req.url.endsWith('png') ? 'image/png' : 'video/mp4')
      return res.end(req.url.endsWith('png') ? png : videoBytes)
    }
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push({ url: req.url, method: req.method, body: body && JSON.parse(body), auth: req.headers.authorization })
    assert.equal(req.headers.authorization, 'Bearer secret')
    if (generationFails) { res.writeHead(503); return res.end('{}') }
    const origin = `http://127.0.0.1:${server.address().port}`
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.method === 'POST' && req.url.includes('/tasks') ? { id: 'remote-task' }
      : req.url.includes('/tasks/') ? { id: 'remote-task', status: 'succeeded', content: { video_url: origin + '/video.mp4' }, duration: 5 }
      : { data: [{ url: origin + '/image.png' }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = join(root, 'byteplus.json'), config = { enabled: true, api_key: 'secret', base_url: `http://127.0.0.1:${server.address().port}/api/v3`, image: { model: 'image-test', size: '2K' }, video: { model: 'video-test', duration: 5, resolution: '720p', ratio: '9:16', generate_audio: true } }
  await writeFile(file, JSON.stringify(config), { mode: 0o600 })
  const runtime = { ELYSIUM_STATE_ROOT: root, ELYSIUM_BYTEPLUS_FILE: file, COMFYUI_URL: 'http://127.0.0.1:9999', ELYSIUM_SERVERS_FILE: join(root, 'absent.json') }
  await mkdir(join(root, 'projects', 'aaaaaaaa', 'media'), { recursive: true })
  await saveJson(join(root, 'projects', 'aaaaaaaa', 'project.json'), { id: 'aaaaaaaa', title: 'test', profile: 'preview', created_at: 1, updated_at: 1 })
  await Promise.all(['anchors', 'materials', 'storyboard', 'deliverables'].map(name => saveJson(join(root, 'projects', 'aaaaaaaa', name + '.json'), [])))
  return { root, file, config, calls, runtime, setVideo: bytes => { videoBytes = bytes }, bind: action => withConfig(runtime, action), failDownload: value => { downloadFails = value }, failGeneration: value => { generationFails = value }, close: async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) } }
}

test('own connected video wins; unavailable own video falls back; model listing never exposes keys', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    assert.equal((await resolveGenerationBackend('video', { probe: async () => true })).provider, 'manual')
    assert.equal((await resolveGenerationBackend('video', { probe: async () => false })).provider, 'byteplus')
    assert.equal((await resolveGenerationBackend('image')).service, 'image')
    const models = await thirdPartyModels()
    assert.equal(models.video.label, 'Seedance 2.0'); assert.doesNotMatch(JSON.stringify(models), /secret|api_key/)
    assert.equal(f.calls.length, 0)
    const original = bytePlusBackend('video')
    f.config.video.model = 'changed-model'; await writeFile(f.file, JSON.stringify(f.config))
    await providerFor(original)
    assert.equal(original.connection.model, 'video-test')
  }) } finally { await f.close() }
})

test('image generation and editing persist usable local images; lost download resumes without another POST', async () => {
  const f = await fixture()
  try { await f.bind(async () => {
    const backend = bytePlusBackend('image'), id = '1'.repeat(32), directory = projectJobRoot('aaaaaaaa', id)
    f.failDownload(true)
    await assert.rejects(executeJob('aaaaaaaa', id, { prompt: '角色' }, backend))
    assert.equal(f.calls.length, 1)
    f.failDownload(false)
    const status = await executeJob('aaaaaaaa', id, { prompt: '角色' }, backend)
    const media = await openLocalMedia(status)
    assert.deepEqual(await media.handle.readFile(), png); await media.handle.close()
    assert.equal(f.calls.length, 1)
    assert.doesNotMatch(await readFile(join(directory, 'status.json'), 'utf8'), /secret/)
    assert.equal((await listAssets(0, 10, { media_kind: 'image' })).total, 1)
    const edited = await executeJob('aaaaaaaa', '2'.repeat(32), { prompt: '更换服装', images: [`job:${id}`] }, backend)
    assert.equal(edited.result.media_kind, 'image')
    assert.match(f.calls.at(-1).body.image[0], /^data:image\/png;base64,/)
    assert.equal(f.calls.at(-1).body.model, 'image-test')
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
    f.config.api_key = ''; await writeFile(f.file, JSON.stringify(f.config))
    await assert.rejects(executeJob('aaaaaaaa', '5'.repeat(32), { prompt: 'test' }, bytePlusBackend('image')), /api_key/)
    assert.equal(f.calls.length, 0)
    assert.equal((await readdir(join(f.root, 'projects', 'aaaaaaaa'))).includes('jobs'), false)
  }) } finally { await f.close() }
})

test('real worker uses saved third-party backend and generated image can be imported as a project anchor', async () => {
  const f = await fixture()
  let web
  try { await f.bind(async () => {
    const backend = bytePlusBackend('image'), id = await createJob('aaaaaaaa', { prompt: '图片锚点' }, backend)
    const result = await waitJob(await launch(id, 'workflow-image'), undefined)
    assert.equal(result.status, 'succeeded'); assert.equal(result.media_kind, 'image')
    const media = createMediaHandler({ token: 't' }), projects = createProjectHandler({ token: 't' })
    web = createServer((req, res) => f.bind(() => req.url.includes('/project/') ? projects(req, res) : media(req, res)))
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${web.address().port}`
    const response = await fetch(origin + `/plugins/dsh-elysium/project/import?t=t`, { method: 'POST', body: JSON.stringify({ id: 'aaaaaaaa', as: 'anchor', job_id: id }) })
    assert.equal(response.status, 200); assert.equal((await response.json()).anchors[0].source.job_id, id)
    assert.deepEqual(Buffer.from(await (await fetch(origin + `/plugins/dsh-elysium/media/image?t=t&job=${id}`)).arrayBuffer()), png)
  }) } finally { if (web) await new Promise(resolve => web.close(resolve)); await f.close() }
})


test('third-party batch extracts a local image anchor and reuses completed shots', async () => {
  const f = await fixture()
  try {
    const path = join(f.root, 'sample.mp4')
    const generated = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=2:d=1', '-pix_fmt', 'yuv420p', path], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    f.setVideo(await readFile(path))
    await f.bind(async () => {
      const manifest = validateProductionManifest({ version: 1, project_id: 'aaaaaaaa', profile: 'preview', shots: [
        { id: 'one', request: { mode: 't2va', prompt: 'Scene' }, media: {}, produces_anchor: { id: 'scene', frame_index: 0 } },
        { id: 'two', request: { mode: 'i2va', prompt: 'Continue' }, media: { first_frame: { anchor: 'scene' } } },
      ] })
      assert.equal((await runProduction(manifest, { log: () => {} })).completed, 2)
      const submitted = f.calls.filter(call => call.method === 'POST')
      assert.equal(submitted.length, 2)
      assert.match(submitted[1].body.content[1].image_url.url, /^data:image\/png;base64,/)
      assert.equal((await runProduction(manifest, { log: () => {} })).completed, 2)
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 2)
    })
  } finally { await f.close() }
})
