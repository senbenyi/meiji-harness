// 职责：验证 AutoDL H3 五种模式及 main 分支导演图均由本 provider 独立构建。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { withConfig } from '../src/config.js'
import adapter from '../src/worker/models/providers/autodl/index.js'
import { buildVideoGraph as buildDirectorGraph, loadVideoTemplates } from '../src/worker/models/providers/autodl/workflows/minimax-h3/director.js'
import { collectDirectorArtifacts } from '../src/worker/models/providers/autodl/workflows/minimax-h3/artifacts.js'
import { toDirectorPlan, validatePlan } from '../src/worker/models/providers/autodl/workflows/minimax-h3/plan.js'

const backend = { provider: 'autodl', provider_api_version: 1, server_id: 'autodl-comfy', instance_id: 'gpu-1', deployment_id: 'h3',
  service: 'comfyui', base_url: 'http://127.0.0.1:8188', connection: { transport: 'http', url: 'http://127.0.0.1:8188', workload: 'minimax-h3' } }
const view = name => `http://127.0.0.1:8188/view?filename=${name}&type=output`

test('AutoDL keeps main H3 generation and director templates byte-identical', async () => {
  const expected = {
    workflow_generate_video: 'a0fbcc5129de658ce5275f8fce7bb8397f0181d1fc754bc3e2b60e9a682cb9a1',
    workflow_director_video: '00040372a0458cee08cbd603b9683e6142dd428c28f7cc0d7b1eb9098dc75bcf',
  }
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = await readFile(new URL(`../src/worker/models/providers/autodl/workflows/minimax-h3/director-templates/${name}.json`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest)
  }
})

test('AutoDL builds all current H3 graphs including T2V and I2V', async () => withConfig({ COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, async () => {
  const media = { first_frame: view('first.png'), last_frame: view('last.png'), reference_image_1: view('one.png'), reference_image_2: view('two.png') }
  const plans = [
    { mode: 't2va', prompt: 'text to video', profile: 'standard' },
    { mode: 'i2va', prompt: 'image to video', profile: 'standard', first_frame: media.first_frame },
    { mode: 'fl2va', prompt: 'first last', profile: 'standard', first_frame: media.first_frame, last_frame: media.last_frame },
    { mode: 'fl2va-loop', prompt: 'loop', profile: 'standard', first_frame: media.first_frame, last_frame: media.last_frame },
    { mode: 'r2va', prompt: 'references', profile: 'standard', reference_image_1: media.reference_image_1, reference_image_2: media.reference_image_2 },
  ]
  for (const plan of plans) {
    if (['t2va', 'i2va'].includes(plan.mode)) await validatePlan(plan)
    const result = await adapter.buildGraph(backend, plan, 'a'.repeat(32))
    assert.equal(result.mode, plan.mode)
    assert.ok(result.graph[result.outputNode])
    assert.match(result.graph[result.outputNode].inputs.filename_prefix, new RegExp(`/a{32}/${plan.mode}/final$`))
  }
}))

test('AutoDL routes ordinary T2V and I2V through the deployed director workflow', () => {
  assert.deepEqual(toDirectorPlan({ mode: 't2va', profile: 'preview', prompt: 'scene' }), { duration: 3, prompts: ['scene'] })
  assert.deepEqual(toDirectorPlan({ mode: 'i2va', profile: 'regular', duration_seconds: 7, prompt: 'move', first_frame: view('first.png') }),
    { duration: 7, prompts: ['move'], image_path: view('first.png') })
  assert.equal(toDirectorPlan({ mode: 'fl2va', prompt: 'scene' }), null)
  assert.deepEqual(toDirectorPlan({ mode: 'i2va', quality: 'regular', duration_seconds: 5, prompt: 'move', first_frame: view('first.png'), seed: 42 }),
    { duration: 5, prompts: ['move'], quality: 'regular', seed: 42, image_path: view('first.png') })
})

test('AutoDL accepts per-take seeds on standard video plans and rejects invalid ones', async () => withConfig({ COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, async () => {
  await validatePlan({ mode: 'i2va', quality: 'regular', duration_seconds: 5, prompt: 'move', first_frame: view('first.png'), seed: 42 })
  await assert.rejects(validatePlan({ mode: 't2va', quality: 'regular', duration_seconds: 5, prompt: 'move', seed: -1 }), /seed/)
}))

test('AutoDL rejects unverified standard modes and overlong single generations', async () => {
  await assert.rejects(validatePlan({ mode: 'fl2va', prompt: 'scene', first_frame: view('first.png'), last_frame: view('last.png') }), /仅开放/)
  await assert.rejects(validatePlan({ mode: 't2va', profile: 'regular', duration_seconds: 16, prompt: 'scene' }), /15 秒/)
})

test('AutoDL builds main director T2V, I2V, continue and per-shot outputs', async () => withConfig({ COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, async () => {
  const templates = await loadVideoTemplates(), job = 'b'.repeat(32), image = view('character.png')
  const textPlan = { duration: 5, prompts: ['A cinematic wide shot'], seed: 9 }
  await validatePlan(textPlan)
  const text = buildDirectorGraph(textPlan, {}, templates, job)
  assert.equal(text.workflowName, 'workflow_generate_video')
  assert.ok(text.graph.final)
  assert.equal(text.graph[text.previewNode].inputs.quality, 35)
  assert.equal(text.graph[text.previewNode].inputs.audio_bitrate, '64k')
  assert.deepEqual(text.graph.elysium_preview_resize.inputs.image, text.graph.final.inputs.images)
  assert.ok(text.graph.s0_save)
  const descriptor = filename => ({ filename, type: 'output' })
  const collected = collectDirectorArtifacts({ url: new URL(backend.base_url), viewUrl: item => view(item.filename) },
    { outputs: { final: { gifs: [descriptor('final.mp4')] }, s0_save: { gifs: [descriptor('shot.mp4')] },
      [text.previewNode]: { gifs: [descriptor('preview.mp4')] } } }, text, 'prompt')
  assert.match(collected.comfyui_view_url, /final\.mp4/)
  assert.match(collected.preview_view_url, /preview\.mp4/)

  const imagePlan = { duration: 10, shots: [
    { id: 'opening', duration: 5, mode: 'independent', prompt: 'same character walks', image_path: image, image_role: 'single-view' },
    { id: 'follow', duration: 5, mode: 'continue', prompt: 'camera follows the same character' },
  ] }
  await validatePlan(imagePlan)
  const result = buildDirectorGraph(imagePlan, { [image]: { name: 'character.png [output]' } }, templates, job)
  assert.equal(result.workflowName, 'workflow_director_video')
  assert.equal(result.shots.length, 2)
  assert.match(result.graph.s0_director.inputs.timeline_data, /character\.png \[output\]/)
  assert.equal(result.graph.s1_conditioning.class_type, 'MiniMaxH3ImageToVideo')
  assert.ok(result.graph.s0_save)
  assert.ok(result.graph.s1_save)
  assert.ok(result.graph.final)
}))

test('global quality changes director specifications but preserves requested duration and shots', async () => withConfig({ COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, async () => {
  const templates = await loadVideoTemplates(), image = view('character.png')
  const expected = { fast: [384, 512, 4], regular: [576, 768, 8], high: [864, 1184, 8] }
  for (const [quality, [width, height, steps]] of Object.entries(expected)) {
    const plan = { quality, duration: 10, shots: [
      { id: 'one', duration: 4, mode: 'independent', prompt: 'walk', image_path: image },
      { id: 'two', duration: 6, mode: 'continue', prompt: 'turn' },
    ] }
    await validatePlan(plan)
    const built = buildDirectorGraph(plan, { [image]: { name: 'character.png [output]' } }, templates, quality.repeat(32).slice(0, 32))
    assert.deepEqual(built.shots.map(shot => [shot.id, shot.duration]), [['one', 4], ['two', 6]])
    assert.deepEqual(built.specification, { width, height, fps: 30, seconds: 10, steps, audio: 'joint-generation-and-decoding' })
    assert.equal(built.graph.s0_director.inputs.width, width)
    assert.equal(built.graph.s0_resize.inputs.height, height)
  }
  assert.equal(toDirectorPlan({ mode: 't2va', quality: 'fast', duration_seconds: 7, prompt: 'scene' }).duration, 7)
}))
