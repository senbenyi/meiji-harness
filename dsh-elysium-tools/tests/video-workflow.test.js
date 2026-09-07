import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, realpath, rm, stat, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const run = promisify(execFile)
const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-test-')))
const artifacts = join(root, 'artifacts')
await mkdir(artifacts)
process.env.ARTIFACTS_ROOT = artifacts
process.env.MINIMAX_H3_COMFYUI_OUTPUT_ROOT = join(root, 'comfy-output')
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'jobs')
process.env.LLM_AI_MODEL_ROOT = fileURLToPath(new URL('../../../llm-ai-model', import.meta.url))
const { createWorkflowTools, getJob, completedResult } = await import('../src/index.js')
const [generate, resume] = createWorkflowTools()
const { validateVideoPlan } = await import('../src/workflows/video-jobs.js')
after(() => rm(root, { recursive: true, force: true }))
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
  assert.equal(playback.port, '6016')
  const published = join(process.env.MINIMAX_H3_COMFYUI_OUTPUT_ROOT, playback.searchParams.get('subfolder'), playback.searchParams.get('filename'))
  assert.deepEqual(await readFile(published), await readFile(queued.path))
  assert.equal((await resume.execute({ job_id: queued.job_id })).job_id, queued.job_id)
  const job = await wait(queued.job_id)
  assert.equal(job.status, 'succeeded', job.error)
  const result = completedResult(job)
  assert.equal(result.validation.full_decode, 'passed')
  assert.equal(result.validation.specification_match, 'passed')
  assert.equal(job.workflow.steps.generate, undefined)
  assert.ok(Math.abs(result.media_info.duration_seconds - 12) < 0.5)
  const before = await stat(result.path)
  await resume.execute({ job_id: queued.job_id })
  assert.equal((await stat(result.path)).mtimeMs, before.mtimeMs)
  const report = JSON.parse(await readFile(`${result.path}.validation.json`, 'utf8'))
  assert.equal(report.inputs.length, 12)
})

test('wrong final duration fails and does not deliver a successful partial result', { skip: !available }, async () => {
  const clip = join(artifacts, 'wrong.mp4')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=1', '-c:v', 'libx264', clip])
  const queued = await generate.execute({ duration: 180, video_paths: [clip] })
  const job = await wait(queued.job_id)
  assert.equal(job.status, 'failed')
  assert.throws(() => completedResult(job), { code: 'MODEL_JOB_NOT_READY' })
  assert.equal(await stat(join(artifacts, `production-${queued.job_id}`, 'output/final.mp4')).catch(() => null), null)
})

test('invalid generation plans fail before a background task starts', async () => {
  for (const args of [{ duration: 180, prompts: ['one'] }, { duration: 180, prompts: Array(12).fill('one') },
    { duration: 10, video_paths: [] }, { duration: 10, prompts: ['one'], video_paths: ['a.mp4'] }]) {
    await assert.rejects(generate.execute(args), { code: 'MODEL_INPUT_INVALID' })
  }
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

test('shot reuse renders mixed frame rates and audio layouts through the real Python workflow', { skip: !available }, async () => {
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
  const continued = await resume.execute({ job_id: submitted.job_id })
  assert.equal(continued.job_id, submitted.job_id)
  const job = await wait(submitted.job_id)
  assert.equal(job.status, 'succeeded', job.error)
  assert.equal(job.result.validation.full_decode, 'passed')
})
