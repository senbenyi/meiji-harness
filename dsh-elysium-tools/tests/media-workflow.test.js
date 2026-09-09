import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, mkdir, realpath, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mockMedia } from './helpers/media-server.js'

const root = await realpath(await mkdtemp(join(tmpdir(), 'native-media-'))), artifacts = join(root, 'artifacts')
await mkdir(artifacts)
process.env.ARTIFACTS_ROOT = artifacts; process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
process.env.LLM_AI_MODEL_ROOT = join(root, 'no-model-checkout')
const backend = await mockMedia(root)
process.env.MINIMAX_H3_COMFYUI_URL = backend.url; process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL = backend.url
const { createModelTools, createWorkflowTools, getJob, apply } = await import('../src/index.js')
const image = createModelTools().find(t => t.name === 'model_generate_image'), concat = createModelTools().find(t => t.name === 'model_concat_video')
const resume = createWorkflowTools().find(t => t.name === 'model_job_resume')
const { findVideoCall } = await import('../src/jobs/call-index.js')
const run = promisify(execFile)
after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
let picture

test('image and reference image use standard visual workflow and survive resume', async () => {
  picture = await image.execute({ prompt: 'A paper boat', seed: 9 }, { agent: { session: { id: 's' } }, callId: 'c' })
  assert.equal(picture.media_kind, 'image'); assert.equal(picture.media_info.width, 832); assert.equal(picture.media_info.height, 1216)
  assert.equal(await findVideoCall('s', 'c'), picture.job_id)
  assert.equal(backend.prompts[0].prompt['5'].inputs.steps, 30)
  assert.equal(backend.prompts[0].prompt['5'].inputs.seed, 9)
  const graph = JSON.parse(await readFile(join(root, 'state/jobs', picture.job_id, 'comfyui-workflow-ui.json')))
  assert.deepEqual(graph, backend.prompts[0].extra_data.extra_pnginfo.workflow)
  assert.equal((await resume.execute({ job_id: picture.job_id })).path, picture.path)
  assert.equal(backend.prompts.length, 1)
  const ref = await image.execute({ prompt: 'Same character at sea', image_path: picture.path })
  assert.equal(ref.status, 'succeeded')
  assert.equal(backend.prompts.at(-1).extra_data.extra_pnginfo.workflow.extra.harness.name, 'workflow_generate_image_reference')
  assert.match(backend.prompts.at(-1).prompt['8'].inputs.image, /\.png$/)
  const { validateVideoPlan } = await import('../src/workflows/video-jobs.js')
  await validateVideoPlan({ duration: 5, image_path: picture.path, prompts: ['Boat drifts'] })
})
test('invalid parameters fail before creating a ComfyUI task, including removed fast preset', async () => {
  const count = backend.prompts.length
  for (const args of [{ prompt: '' }, { prompt: 'boat', preset: 'fast' }, { prompt: 'boat', seed: 0.5 }, { prompt: 'boat', image_path: '/etc/hosts' }]) await assert.rejects(image.execute(args), { code: 'MODEL_INPUT_INVALID' })
  await assert.rejects(concat.execute({ video_paths: [] }), { code: 'MODEL_INPUT_INVALID' })
  assert.equal(backend.prompts.length, count)
})
test('confirmed failed image resumes under the same job ID', async () => {
  backend.controls.fail = true
  let id
  try { await image.execute({ prompt: 'Boat' }) } catch (e) { id = e.message.match(/[0-9a-f]{32}/)[0] }
  assert.equal((await getJob(id)).status, 'failed')
  backend.controls.fail = false
  assert.equal((await resume.execute({ job_id: id })).job_id, id)
  assert.equal((await getJob(id)).status, 'succeeded')
})
test('native concat preserves order, source dimensions, fps, duration and silent audio layout', async () => {
  const paths = []
  for (const color of ['red', 'blue']) {
    const path = join(artifacts, color + '.mp4'); paths.push(path)
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24:d=1`, '-c:v', 'libx264', path])
  }
  const result = await concat.execute({ video_paths: paths })
  assert.equal(result.media_info.width, 64); assert.equal(result.media_info.frame_rate, 24)
  assert.equal(result.media_info.has_audio, false); assert.equal(result.media_info.duration_seconds, 2)
  const request = backend.prompts.at(-1)
  assert.equal(request.extra_data.extra_pnginfo.workflow.extra.harness.name, 'workflow_concat_video')
  assert.equal('audio' in request.prompt['7'].inputs, false)
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', result.path, '-vf', "select='eq(n,0)+eq(n,24)',scale=1:1", '-vsync', '0', '-frames:v', '2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  assert.ok(stdout[0] > stdout[2]); assert.ok(stdout[5] > stdout[3])
})
