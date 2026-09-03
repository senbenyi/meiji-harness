import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createGenerationService } from '../src/elysium/server/lib/generate.js'
import { projectCreate, projectGet } from '../src/elysium/server/lib/project.js'
import { projectDir, writeJsonAtomic } from '../src/elysium/server/lib/store.js'

async function fixture(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-elysium-generate-test-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = {
    workspace,
    models: { shotVideo: { template: 'test-video', args: {} } },
  }
  const created = await projectCreate(config, { title: '生成测试' })
  const projectId = created.project.id
  const directory = projectDir(config, projectId)
  await writeJsonAtomic(path.join(directory, 'characters.json'), [{
    id: 'char-001', name: '主角', description: '短发少年', imagePath: null,
  }])
  await writeJsonAtomic(path.join(directory, 'shots.json'), [{
    id: 'shot-001', order: 1, durationSec: 5, characterIds: ['char-001'], sceneId: null,
    description: '主角站在雨中', camera: '中景', imagePrompt: 'cinematic rain', videoPrompt: '',
    status: 'prompt_ready', retryCount: 0, lastError: null,
  }])
  return { config, projectId, directory }
}

async function waitFor(check, timeout = 1000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for generation state')
}

async function addFirstFrame(directory) {
  const relativePath = 'assets/shots/shot-001-image.jpg'
  const file = path.join(directory, relativePath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, 'fake jpg')
  return relativePath
}

test('generates a shot image and copies the ComfyUI output into project assets', async (t) => {
  const { config, projectId, directory } = await fixture(t)
  const output = path.join(config.workspace, 'comfy-output.png')
  await writeFile(output, 'fake png')
  const tools = new Map([
    ['_dsh_external_dsh_comfyui_generate', { execute: async () => JSON.stringify({ ok: true, job_id: 'job-1' }) }],
    ['_dsh_external_dsh_comfyui_job', { execute: async () => JSON.stringify({
      ok: true, status: 'success', outputs: [{ kind: 'image', path: output }],
    }) }],
  ])
  const service = createGenerationService({ tools: { get: name => tools.get(name) } }, config)
  t.after(() => service.dispose())

  const queued = await service.submitShotImage(projectId, 'shot-001')
  assert.equal(queued.shot.status, 'image_queued')
  const ready = await waitFor(async () => {
    const data = await projectGet(config, { projectId })
    return data.shots[0].status === 'image_ready' ? data : null
  })
  const shot = ready.shots[0]
  assert.match(shot.imagePath, /^assets\/shots\/shot-001-image-/)
  assert.equal(await readFile(path.join(directory, shot.imagePath), 'utf8'), 'fake png')
})

test('persists a useful failed state when dsh-comfyui is unavailable', async (t) => {
  const { config, projectId } = await fixture(t)
  const service = createGenerationService({ tools: { get: () => undefined } }, config)
  t.after(() => service.dispose())

  await assert.rejects(
    service.submitShotImage(projectId, 'shot-001'),
    error => error.code === 'COMFYUI_UNAVAILABLE',
  )
  const data = await projectGet(config, { projectId })
  assert.equal(data.shots[0].status, 'failed')
  assert.equal(data.shots[0].failedStage, 'image')
  assert.match(data.shots[0].lastError, /not enabled/)
})

test('preserves the original failure when reconciling an interrupted submission', async (t) => {
  const { config, projectId, directory } = await fixture(t)
  const shotsPath = path.join(directory, 'shots.json')
  const shots = JSON.parse(await readFile(shotsPath, 'utf8'))
  const imagePath = await addFirstFrame(directory)
  await writeJsonAtomic(shotsPath, [{
    ...shots[0],
    imagePath,
    status: 'video_queued',
    videoJobId: null,
    failedStage: null,
    lastError: 'HTTP POST /upload/image: fetch failed',
  }])
  const service = createGenerationService({ tools: { get: () => undefined } }, config)
  t.after(() => service.dispose())

  await service.batchStatus(projectId)

  const data = await projectGet(config, { projectId })
  assert.equal(data.shots[0].status, 'failed')
  assert.equal(data.shots[0].failedStage, 'video')
  assert.equal(data.shots[0].lastError, 'HTTP POST /upload/image: fetch failed')
})

test('does not reconcile an in-flight video submission as interrupted', async (t) => {
  const { config, projectId, directory } = await fixture(t)
  const shotsPath = path.join(directory, 'shots.json')
  const shots = JSON.parse(await readFile(shotsPath, 'utf8'))
  const imagePath = await addFirstFrame(directory)
  await writeJsonAtomic(shotsPath, [{
    ...shots[0],
    imagePath,
    status: 'failed',
    failedStage: 'video',
    retryCount: 3,
    lastError: 'HTTP POST /upload/image: fetch failed',
  }])
  let rejectSubmission
  const tools = new Map([
    ['_dsh_external_dsh_comfyui_generate', {
      execute: () => new Promise((resolve, reject) => { rejectSubmission = reject }),
    }],
  ])
  const service = createGenerationService({ tools: { get: name => tools.get(name) } }, config)
  t.after(() => service.dispose())

  const submission = service.submitShotVideo(projectId, 'shot-001').catch(error => error)
  await waitFor(async () => {
    const data = await projectGet(config, { projectId })
    return data.shots[0].status === 'video_queued' ? data : null
  })
  await service.batchStatus(projectId)

  const queued = await projectGet(config, { projectId })
  assert.equal(queued.shots[0].status, 'video_queued')
  assert.equal(queued.shots[0].lastError, 'HTTP POST /upload/image: fetch failed')

  rejectSubmission(new Error('HTTP POST /upload/image: fetch failed'))
  await submission
  const failed = await projectGet(config, { projectId })
  assert.equal(failed.shots[0].status, 'failed')
  assert.equal(failed.shots[0].lastError, 'HTTP POST /upload/image: fetch failed')
})

test('allows video retry after three historical failures when a first frame exists', async (t) => {
  const { config, projectId, directory } = await fixture(t)
  const shotsPath = path.join(directory, 'shots.json')
  const output = path.join(config.workspace, 'comfy-output.mp4')
  await writeFile(output, 'fake mp4')
  const shots = JSON.parse(await readFile(shotsPath, 'utf8'))
  const imagePath = await addFirstFrame(directory)
  await writeJsonAtomic(shotsPath, [{
    ...shots[0],
    imagePath,
    status: 'failed',
    failedStage: 'video',
    retryCount: 3,
    lastError: 'previous failure',
  }])
  const tools = new Map([
    ['_dsh_external_dsh_comfyui_generate', { execute: async () => JSON.stringify({ ok: true, job_id: 'job-video' }) }],
    ['_dsh_external_dsh_comfyui_job', { execute: async () => JSON.stringify({
      ok: true, status: 'success', outputs: [{ kind: 'video', path: output }],
    }) }],
  ])
  const service = createGenerationService({ tools: { get: name => tools.get(name) } }, config)
  t.after(() => service.dispose())

  await service.retryShot(projectId, 'shot-001')
  const ready = await waitFor(async () => {
    const data = await projectGet(config, { projectId })
    return data.shots[0].status === 'video_ready' ? data : null
  })

  assert.equal(ready.shots[0].retryCount, 4)
  assert.match(ready.shots[0].videoPath, /^assets\/shots\/shot-001-video-/)
})
