import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, realpath, rm, stat, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { mockComfy } from './helpers/comfy-server.js'

const run = promisify(execFile)
const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-test-')))
const artifacts = join(root, 'artifacts')
await mkdir(artifacts)
process.env.ARTIFACTS_ROOT = artifacts
process.env.MINIMAX_H3_COMFYUI_OUTPUT_ROOT = join(root, 'comfy-output')
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'jobs')
const backend = await mockComfy(root)
process.env.MINIMAX_H3_COMFYUI_URL = backend.url
process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL = backend.url
const { createWorkflowTools, getJob, completedResult } = await import('../src/index.js')
const [generate, resume] = createWorkflowTools()
const { validateVideoPlan } = await import('../src/workflows/video-jobs.js')
after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
let available = true
try { await run('ffmpeg', ['-version']); await run('ffprobe', ['-version']) } catch { available = false }

async function wait(jobId) {
  for (let i = 0; i < 150; i++) {
    const job = await getJob(jobId)
    const lock = join(root, 'jobs/jobs', jobId, 'worker.lock')
    if (['succeeded', 'failed'].includes(job.status) && !await stat(lock).catch(() => null)) return job
    await sleep(100)
  }
  throw new Error('Workflow did not finish')
}

test('production tool waits and delivers 12 concatenated clips without model polling', { skip: !available }, async () => {
  const clip = join(artifacts, 'clip.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  const queued = await generate.execute({ duration: 12, video_paths: Array(12).fill(clip) },
    { agent: { session: { id: 'media-session' } }, callId: 'media-call' })
  const { findVideoCall } = await import('../src/jobs/call-index.js')
  assert.equal(await findVideoCall('media-session', 'media-call'), queued.job_id)
  assert.equal(queued.status, 'succeeded')
  assert.ok(queued.path.endsWith('/final.mp4'))
  const playback = new URL(queued.comfyui_view_url)
  assert.equal(playback.origin, backend.url)
  assert.deepEqual(Buffer.from(await (await fetch(playback)).arrayBuffer()), await readFile(queued.path))
  assert.equal((await resume.execute({ job_id: queued.job_id })).job_id, queued.job_id)
  const job = await wait(queued.job_id)
  assert.equal(job.status, 'succeeded', job.error)
  const result = completedResult(job)
  assert.equal(result.validation.full_decode, 'passed')
  assert.equal(result.validation.specification_match, 'passed')
  assert.equal(job.backend, 'comfyui')
  assert.equal(backend.prompts.length, 1)
  assert.equal(job.workflow_name, 'workflow_director_video')
  const savedWorkflow = JSON.parse(await readFile(join(root, 'jobs/jobs', job.job_id, 'comfyui-workflow-ui.json'), 'utf8'))
  assert.equal(savedWorkflow.extra.harness.name, 'workflow_director_video')
  assert.deepEqual(backend.prompts[0].extra_data.extra_pnginfo.workflow, savedWorkflow)
  assert.equal(savedWorkflow.nodes.find(n => n.id === 'final').type, 'DaSiWa_EnhancedVideoCombine')
  assert.ok(Math.abs(result.media_info.duration_seconds - 12) < 0.5)
  const before = await stat(result.path)
  await resume.execute({ job_id: queued.job_id })
  assert.equal((await stat(result.path)).mtimeMs, before.mtimeMs)
  const report = JSON.parse(await readFile(`${result.path}.validation.json`, 'utf8'))
  assert.equal(report.shots.length, 12)
})

test('wrong source duration fails before submitting any ComfyUI task', { skip: !available }, async () => {
  const clip = join(artifacts, 'wrong.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=1', '-c:v', 'libx264', clip])
  const before = backend.prompts.length
  const queued = await generate.execute({ duration: 180, video_paths: [clip] })
  const job = await wait(queued.job_id)
  assert.equal(job.status, 'failed')
  assert.equal(job.failed_stage, 'prepare')
  assert.match(job.error, /素材总时长/)
  assert.equal(backend.prompts.length, before)
  assert.throws(() => completedResult(job), { code: 'MODEL_JOB_NOT_READY' })
  assert.equal(await stat(join(artifacts, `production-${queued.job_id}`, 'output/final.mp4')).catch(() => null), null)
})

test('invalid generation plans fail before a background task starts', async () => {
  for (const args of [{ duration: 180, prompts: ['one'] }, { duration: 180, prompts: Array(12).fill('one') },
    { duration: 10, video_paths: [] }, { duration: 10, prompts: ['one'], video_paths: ['a.mp4'] }]) {
    await assert.rejects(generate.execute(args), { code: 'MODEL_INPUT_INVALID' })
  }
})

test('an audio tail cannot make a mismatched video pass the container-duration check', { skip: !available }, async () => {
  const clip = join(artifacts, 'audio-tail.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=1', '-c:v', 'libx264', clip])
  backend.controls.audioTail = 0.3
  try {
    const result = await generate.execute({ duration: 1, video_paths: [clip] })
    assert.equal(result.status, 'failed')
    assert.match(result.error, /规格验证/)
  } finally { backend.controls.audioTail = 0 }
})

test('three five-second shots preserve their contract and validate references before generation', async () => {
  const image = join(artifacts, 'character.png')
  const audio = join(artifacts, 'voice.wav')
  await writeFile(image, 'fixture')
  await writeFile(audio, 'fixture')
  const plan = { duration: 15, shots: [
    { id: 's01', duration: 5, prompt: 'A深蓝衬衫：明天你还会来吗？', image_path: image },
    { id: 's02', duration: 5, prompt: 'B米白针织衫：会，我答应过你。', mode: 'reference', image_path: image, audio_path: audio },
    { id: 's03', duration: 5, prompt: '接续动作', mode: 'continue' },
  ] }
  const original = structuredClone(plan)
  await validateVideoPlan(plan)
  assert.deepEqual(plan, original)
  for (const change of [
    p => { p.duration = 10 },
    p => { p.shots[1].id = 's01' },
    p => { p.shots[0].mode = 'continue' },
    p => { p.shots[1].audio_path = join(artifacts, 'missing.wav') },
    p => { p.shots[2].image_path = image },
    p => { p.prompts = ['缩水版本'] },
    p => { p.shots[0].audio_path = audio },
    p => { p.shots[0].in_point = 1 },
  ]) {
    const invalid = structuredClone(plan)
    change(invalid)
    await assert.rejects(validateVideoPlan(invalid), { code: 'MODEL_INPUT_INVALID' })
  }
})

test('shot reuse renders mixed frame rates and audio layouts through the HTTP task contract', { skip: !available }, async () => {
  const silent = join(artifacts, 'silent.mp4'), voiced = join(artifacts, 'voiced.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=2', '-c:v', 'libx264', silent])
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=96x64:r=25:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', voiced])
  const result = await generate.execute({ duration: 2, shots: [
    { id: 'selected-a', mode: 'reuse', video_path: silent, in_point: 1, duration: 1 },
    { id: 'selected-b', mode: 'reuse', video_path: voiced, duration: 1 },
  ] })
  assert.equal(result.status, 'succeeded', result.error)
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.path])
  const [video, audio] = JSON.parse(stdout).streams
  assert.equal(video.avg_frame_rate, '30/1')
  assert.equal(video.width, 480)
  assert.equal(video.height, 854)
  assert.ok(Math.abs(Number(video.duration) - 2) < 0.1)
  assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) < 0.1)
  assert.equal(result.validation.human_review, 'not_run')
  assert.deepEqual(result.shots.map(s => s.id), ['selected-a', 'selected-b'])
  for (const shot of result.shots) {
    assert.ok((await stat(shot.path)).size > 0)
    assert.equal(new URL(shot.comfyui_view_url).origin, backend.url)
  }
  const report = JSON.parse(await readFile(`${result.path}.validation.json`, 'utf8'))
  assert.deepEqual(report.shots.map(s => s.id), ['selected-a', 'selected-b'])
})

test('workflow survives submitting process exit and failed validation resumes under the same ID', { skip: !available }, async () => {
  const clip = join(artifacts, 'resume.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=1', '-c:v', 'libx264', clip])
  const source = new URL('../src/workflows/video-jobs.js', import.meta.url).href
  const script = `const { startVideoJob } = await import(${JSON.stringify(source)}); console.log(JSON.stringify(await startVideoJob(${JSON.stringify({ duration: 1, video_paths: [clip] })})))`
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, FFPROBE_BIN: join(root, 'unavailable-ffprobe') },
  })
  const submitted = JSON.parse(stdout)
  assert.equal((await wait(submitted.job_id)).status, 'failed')
  const continued = await resume.execute({ job_id: submitted.job_id }, {
    agent: { session: { id: 'resume-session' } },
    get callId() {
      const status = JSON.parse(readFileSync(join(root, 'jobs/jobs', submitted.job_id, 'status.json'), 'utf8'))
      assert.notEqual(status.status, 'failed', 'new call must never bind to the old failed state')
      return 'resume-call'
    },
  })
  assert.equal(continued.job_id, submitted.job_id)
  const job = await wait(submitted.job_id)
  assert.equal(job.status, 'succeeded', job.error)
  assert.equal(job.result.validation.full_decode, 'passed')
})

test('dead or reused worker PID recovers the original prompt without resubmitting', { skip: !available }, async () => {
  const result = await generate.execute({ duration: 1, prompts: ['recover original'] })
  const original = await wait(result.job_id), directory = join(root, 'jobs/jobs', result.job_id)
  const before = backend.prompts.length
  for (const pid of [2147483647, process.pid]) {
    await rm(result.path)
    await writeFile(join(directory, 'status.json'), JSON.stringify({ ...original, status: 'running', stage: 'execute' }))
    await writeFile(join(directory, 'worker.lock'), String(pid))
    const results = await Promise.allSettled([resume.execute({ job_id: result.job_id }), resume.execute({ job_id: result.job_id })])
    assert.ok(results.some(r => r.status === 'fulfilled' && r.value.status === 'succeeded'))
    for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'WORKFLOW_RECOVERY_REQUIRED')
    const recovered = await wait(result.job_id)
    assert.equal(recovered.comfyui_prompt_id, original.comfyui_prompt_id)
    assert.equal(backend.prompts.length, before)
    assert.ok((await stat(result.path)).size > 0)
  }
})

test('corrupt reusable shot prevents successful final publication and can resume without inference', { skip: !available }, async () => {
  backend.controls.corruptShot = true
  let result
  try { result = await generate.execute({ duration: 1, prompts: ['validate shot'] }) }
  finally { backend.controls.corruptShot = false }
  await wait(result.job_id)
  assert.equal(result.status, 'failed')
  assert.equal(result.remote_status, 'succeeded')
  assert.equal(await stat(join(artifacts, `production-${result.job_id}`, 'output/final.mp4')).catch(() => null), null)
  const before = backend.prompts.length
  const downloads = backend.controls.downloads.length
  const recovered = await resume.execute({ job_id: result.job_id })
  assert.equal(backend.controls.downloads.length - downloads, 1, 'reuse verified final, download only failed shot')
  assert.equal(recovered.status, 'succeeded')
  assert.equal(recovered.shots[0].validation.full_decode, 'passed')
  assert.equal(backend.prompts.length, before)
  await wait(result.job_id)
})
