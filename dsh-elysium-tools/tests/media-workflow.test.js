import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, mkdir, realpath, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mockMedia } from './helpers/media-server.js'

const root = await realpath(await mkdtemp(join(tmpdir(), 'native-media-'))), artifacts = join(root, 'artifacts')
await mkdir(artifacts)
process.env.ARTIFACTS_ROOT = artifacts; process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
const backend = await mockMedia(root)
process.env.MINIMAX_H3_COMFYUI_URL = backend.url; process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL = backend.url
const { createWorkflowTools, getJob } = await import('../src/index.js')
const image = createWorkflowTools().find(t => t.name === 'workflow_generate_image')
const resume = createWorkflowTools().find(t => t.name === 'model_job_resume')
const { findVideoCall } = await import('../src/jobs/call-index.js')
after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
let picture

test('image and reference image use standard visual workflow and survive resume', async () => {
  picture = await image.execute({ prompt: 'A paper boat', seed: 9 }, { agent: { session: { id: 's' } }, callId: 'c' })
  assert.deepEqual(picture, JSON.parse(JSON.stringify(picture)), 'Harness requires lossless JSON tool output')
  for (const key of image.output.schema.required) assert.ok(Object.hasOwn(picture, key), `Image output missing required ${key}`)
  assert.equal(picture.media_kind, 'image'); assert.equal(picture.media_info, undefined); assert.equal(picture.validation.full_decode, 'not_run')
  assert.equal(await findVideoCall('s', 'c'), picture.job_id)
  assert.equal(backend.prompts[0].prompt['5'].inputs.steps, 30)
  assert.equal(backend.prompts[0].prompt['5'].inputs.seed, 9)
  const graph = JSON.parse(await readFile(join(root, 'state/jobs', picture.job_id, 'comfyui-workflow-ui.json')))
  assert.deepEqual(graph, backend.prompts[0].extra_data.extra_pnginfo.workflow)
  const recovered = await resume.execute({ job_id: picture.job_id })
  assert.equal(recovered.path, picture.path)
  assert.deepEqual(recovered, JSON.parse(JSON.stringify(recovered)))
  assert.equal(backend.prompts.length, 1)
  const ref = await image.execute({ prompt: 'Same character at sea', image_path: picture.path })
  assert.equal(ref.status, 'succeeded')
  assert.deepEqual(ref, JSON.parse(JSON.stringify(ref)))
  assert.equal(backend.prompts.at(-1).extra_data.extra_pnginfo.workflow.extra.harness.name, 'workflow_generate_image_reference')
  assert.match(backend.prompts.at(-1).prompt['8'].inputs.image, /\.png \[output\]$/)
  const { validateVideoPlan } = await import('../src/workflows/video-jobs.js')
  await validateVideoPlan({ duration: 5, image_path: picture.path, prompts: ['Boat drifts'] })
})
test('invalid parameters fail before creating a ComfyUI task, including removed fast preset', async () => {
  const count = backend.prompts.length
  for (const args of [{ prompt: '' }, { prompt: 'boat', preset: 'fast' }, { prompt: 'boat', seed: 0.5 }, { prompt: 'boat', image_path: '/etc/hosts' }]) await assert.rejects(image.execute(args), { code: 'MODEL_INPUT_INVALID' })
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
test('image results do not fetch bytes, save files or claim validation', async () => {
  backend.controls.corruptOutput = true
  const before = backend.controls.views.length
  let result
  try { result = await image.execute({ prompt: 'Keep the HTTP result' }) }
  finally { backend.controls.corruptOutput = false }
  assert.equal(result.status, 'succeeded')
  assert.equal(result.validation.full_decode, 'not_run')
  assert.equal(result.size_bytes, undefined)
  assert.equal(result.sha256, undefined)
  assert.equal(await stat(join(artifacts, `production-${result.job_id}`, 'output/final.png')).catch(() => null), null)
  const count = backend.prompts.length
  assert.equal((await resume.execute({ job_id: result.job_id })).path, result.path)
  assert.equal(backend.prompts.length, count)
  assert.equal(backend.controls.views.length, before)
})
