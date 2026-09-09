import { mockComfy } from './helpers/comfy-server.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await realpath(await mkdtemp(join(tmpdir(), 'h3-tools-test-')))
const endpoints = join(root, 'scripts', 'endpoint')
const artifacts = join(root, 'artifacts')
await mkdir(endpoints, { recursive: true })
await mkdir(artifacts)
process.env.ARTIFACTS_ROOT = artifacts
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
const backend = await mockComfy(root)
process.env.MINIMAX_H3_COMFYUI_URL = backend.url
process.env.MINIMAX_H3_COMFYUI_PUBLIC_URL = backend.url
after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
const { createModelTools } = await import('../src/index.js')

const image = `${backend.url}/view?filename=reference.png&type=output`
const audio = `${backend.url}/view?filename=reference.mp3&type=output`

for (const mode of ['text', 'image', 'reference']) {
  test(`${mode} routes through the video capability and preserves prompt/media`, async () => {
    const tool = createModelTools().find(t => t.name === 'model_generate_video')
    assert.deepEqual(tool.parameters.properties.mode.enum, ['text', 'image', 'reference'])
    const args = { prompt: '你好，今天阳光很好。', seed: 123, mode }
    if (mode === 'image') args.image_path = image
    if (mode === 'reference') args.audio_path = audio
    const result = await tool.execute(args, { agent: { session: { id: 'alias-session' } }, callId: mode })
    assert.equal(result.status, 'succeeded')
    const { findVideoCall } = await import('../src/jobs/call-index.js')
    assert.equal(await findVideoCall('alias-session', mode), result.job_id)
    const request = backend.prompts.at(-1)
    assert.equal(request.extra_data.extra_pnginfo.workflow.extra.harness.name, 'workflow_generate_video')
    assert.equal(request.prompt.s0_director.inputs.mode, { text: 'T2VA', image: 'I2VA', reference: 'REF2VA' }[mode])
    assert.equal(request.prompt.s0_director.inputs.prompt, args.prompt)
    assert.equal(request.prompt.s0_noise.inputs.seed_value, 123)
    const items = JSON.parse(request.prompt.s0_director.inputs.timeline_data).items
    assert.equal(items.length, mode === 'text' ? 0 : 1)

  })
}

test('reference modes reject missing media before running the endpoint', async () => {
  for (const mode of ['image', 'reference']) {
    const tool = createModelTools().find(t => t.name === 'model_generate_video')
    await assert.rejects(tool.execute({ mode, prompt: 'hello' }), error => error.code === 'MODEL_INPUT_INVALID')
  }
})

test('video rejects missing or unknown modes', async () => {
  const tool = createModelTools().find(t => t.name === 'model_generate_video')
  for (const mode of [undefined, 'invalid']) {
    await assert.rejects(tool.execute({ mode, prompt: 'hello' }), error => error.code === 'MODEL_INPUT_INVALID')
  }
})

test('short video accepts 15 seconds and rejects longer or invalid durations', async () => {
  const tool = createModelTools().find(t => t.name === 'model_generate_video')
  const result = await tool.execute({ mode: 'text', prompt: 'Paper boat', duration: 15 })
  assert.equal(result.status, 'succeeded')
  assert.equal(backend.prompts.at(-1).prompt.s0_director.inputs.duration, 15)
  for (const duration of [0, 16, 1.5, '15']) {
    await assert.rejects(tool.execute({ mode: 'text', prompt: 'Paper boat', duration }), { code: 'MODEL_INPUT_INVALID' })
  }
})

test('long video uses the director workflow and preserves total duration', async () => {
  const tool = createModelTools().find(t => t.name === 'model_generate_video_long')
  const args = { image_path: image, prompts: ['Paper boat drifts', 'Boat reaches shore'], duration: 16 }
  const result = await tool.execute(args)
  assert.equal(result.status, 'succeeded')
  const request = backend.prompts.at(-1)
  assert.equal(request.extra_data.extra_pnginfo.workflow.extra.harness.name, 'workflow_director_video')
  assert.equal(request.prompt.s0_director.inputs.duration + request.prompt.s1_director.inputs.duration, 16)
  assert.equal(request.prompt.s1_director.inputs.prompt, args.prompts[1])
  for (const duration of [15, 0, 181]) {
    await assert.rejects(tool.execute({ ...args, duration }), { code: 'MODEL_INPUT_INVALID' })
  }
  await assert.rejects(tool.execute({ ...args, preset: 'long_mvp_preview' }), { code: 'MODEL_INPUT_INVALID' })
  await assert.rejects(tool.execute({ ...args, prompts: Array(17).fill('Boat'), duration: 16 }), { code: 'MODEL_INPUT_INVALID' })
})
