import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withConfig } from '../src/config.js'
import { buildVideoGraph, loadVideoTemplate } from '../src/workflows/video-graph.js'
import { validateVideoPlan } from '../src/workflows/video-plan.js'
import { createWorkflowGenerateVideoTool } from '../src/workflows/workflow-generate-video.js'

test('preview is aligned, keeps joint audio and removes all interpolation dependencies', async () => {
  const plan = { profile: 'preview', mode: 't2va', prompt: 'An adult opens a door.' }
  await validateVideoPlan(plan)
  const before = await loadVideoTemplate('t2va')
  const p = await buildVideoGraph(plan, 'shot')
  assert.deepEqual([p.specification.width, p.specification.height, p.specification.frames, p.specification.fps], [384, 512, 73, 24])
  assert.equal(p.specification.seconds, 73 / 24)
  assert.equal(p.graph.n105_9.inputs.steps, 8)
  assert.equal(Object.values(p.graph).some(n => /Rife|Upscale|LoraLoader/.test(n.class_type)), false)
  assert.deepEqual(p.graph.n126.inputs.images, ['n105_10', 0])
  assert.deepEqual(p.graph.n126.inputs.audio, ['n105_23', 0])
  assert.equal(p.workflow, undefined, 'do not attach stale full-quality UI graph')
  assert.deepEqual(await loadVideoTemplate('t2va'), before)
  const standard = await buildVideoGraph({ mode: 't2va', prompt: plan.prompt, profile: 'standard' }, 'shot')
  assert.equal(standard.graph.n126.inputs.frame_rate, 48)
})

test('preview I2V uses the existing remote image reference and rejects unsupported modes', async () => withConfig({ COMFYUI_URL: 'https://pod.test' }, async () => {
  const plan = { profile: 'preview', mode: 'i2va', prompt: 'The adult waves.', first_frame: 'https://pod.test/view?filename=anchor.png&type=output&subfolder=preview' }
  await validateVideoPlan(plan)
  const p = await buildVideoGraph(plan, 'shot')
  assert.equal(p.graph.preview_image.inputs.image, 'preview/anchor.png [output]')
  assert.deepEqual(p.graph.n105_104.inputs.first_frame, ['preview_image', 0])
  await assert.rejects(validateVideoPlan({ profile: 'preview', mode: 'r2va', prompt: 'x' }), /preview/)
  await assert.rejects(validateVideoPlan({ profile: 'fast', mode: 't2va', prompt: 'x' }), /profile/)
}))

test('low-resolution candidate changes only dimensions and output location; default stays identical', async () => {
  const plan = { profile: 'preview', mode: 't2va', prompt: 'An adult opens a door.' }
  const baseline = await buildVideoGraph(plan, 'shot')
  assert.deepEqual(await buildVideoGraph({ ...plan, preview_variant: 'default' }, 'shot'), baseline)
  const candidate = { ...plan, preview_variant: 'low-resolution' }
  await validateVideoPlan(candidate)
  const p = await buildVideoGraph(candidate, 'shot')
  assert.deepEqual([p.specification.width, p.specification.height, p.specification.frames, p.specification.steps], [288, 384, 73, 8])
  assert.equal(p.specification.preview_variant, 'low-resolution')
  const expected = structuredClone(baseline.graph)
  Object.assign(expected.n105_104.inputs, { width: 288, height: 384 })
  expected.n126.inputs.filename_prefix = 'elysium/shot/preview-low-resolution/final'
  assert.deepEqual(p.graph, expected, 'seed, prompt, audio, sampler and patches must not change')
  const schema = createWorkflowGenerateVideoTool().parameters.properties.preview_variant
  assert.deepEqual(schema.enum, ['default', 'low-resolution'])
  for (const args of [{ ...candidate, profile: 'standard' }, { ...candidate, preview_variant: '4-step' }]) {
    await assert.rejects(validateVideoPlan(args), /preview_variant/)
  }
})
