import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withConfig } from '../../../../config.js'
import { buildVideoGraph, loadVideoTemplate } from '../workflows/minimax-h3/graph.js'
import { validatePlan as validateVideoPlan } from '../plan.js'
import { createWorkflowGenerateVideoTool } from '../../../../tools/video.js'
import { collectVideoArtifacts } from '../../../../business/video/artifacts.js'
import { ComfyClient } from '../../../../comfyui/client.js'
import { VIDEO_MODES, MODE_MEDIA } from '../../../../business/video/plan.js'

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

test('regular uses aligned five-second graph, keeps image conditioning and reports its own profile', async () => withConfig({ COMFYUI_URL: 'https://pod.test' }, async () => {
  const plan = { profile: 'regular', mode: 'i2va', prompt: 'The adult waves.', first_frame: 'https://pod.test/view?filename=anchor.png&type=output' }
  await validateVideoPlan(plan)
  const p = await buildVideoGraph(plan, 'shot')
  assert.deepEqual([p.specification.width, p.specification.height, p.specification.frames, p.specification.fps, p.specification.steps], [576, 768, 124, 24, 8])
  assert.equal(p.specification.seconds, 124 / 24)
  assert.deepEqual(p.graph.n105_104.inputs.first_frame, ['preview_image', 0])
  assert.deepEqual(p.graph.n126.inputs.images, ['n105_10', 0])
  assert.deepEqual(p.graph.n126.inputs.audio, ['n105_23', 0])
  assert.equal(p.workflow, undefined)
  const result = await collectVideoArtifacts(new ComfyClient('https://pod.test'), { outputs: { n126: { gifs: [{ filename: 'final.mp4', type: 'output' }] } } }, p, 'prompt')
  assert.equal(result.profile, 'regular')
  for (const args of [{ ...plan, preview_variant: 'low-resolution' }, { profile: 'regular', mode: 'fl2va', prompt: 'x' }]) await assert.rejects(validateVideoPlan(args))
}))

test('regular supports requested durations through 15 seconds in one aligned generation', async () => withConfig({ COMFYUI_URL: 'https://pod.test' }, async () => {
  for (const mode of ['t2va', 'i2va']) {
    const plan = { profile: 'regular', mode, prompt: 'One continuous shot.', ...(mode === 'i2va' ? { first_frame: 'https://pod.test/view?filename=anchor.png&type=output' } : {}) }
    for (const [duration_seconds, frames] of [[5, 124], [10, 243], [15, 362], [15.08, 362]]) {
      await validateVideoPlan({ ...plan, duration_seconds })
      const p = await buildVideoGraph({ ...plan, duration_seconds }, 'shot')
      assert.equal(p.graph.n105_104.inputs.length, frames)
      assert.equal(p.specification.requested_seconds, duration_seconds)
      assert.equal(p.specification.seconds, frames / 24)
      assert.equal(Object.values(p.graph).filter(node => node.class_type === p.graph.n105_104.class_type).length, 1)
      assert.deepEqual(p.graph.n126.inputs.audio, ['n105_23', 0])
      assert.equal(p.graph.n105_9.inputs.steps, 8)
    }
  }
  const schema = createWorkflowGenerateVideoTool().parameters.properties.duration_seconds
  assert.equal(schema.maximum, undefined)
  for (const duration_seconds of [0, -1, '15', null, NaN, Infinity]) {
    await assert.rejects(validateVideoPlan({ profile: 'regular', mode: 't2va', prompt: 'x', duration_seconds }), /duration_seconds/)
  }
  for (const profile of ['preview', 'high-quality', 'standard', undefined]) {
    await assert.rejects(validateVideoPlan({ profile, mode: 't2va', prompt: 'x', duration_seconds: 15 }), /duration_seconds/)
  }
}))

test('high-quality preserves every original native workflow and legacy standard routing', async () => withConfig({ COMFYUI_URL: 'https://pod.test' }, async () => {
  for (const mode of VIDEO_MODES) {
    const plan = { mode, prompt: 'Two adults meet.', ...Object.fromEntries(MODE_MEDIA[mode].map(name => [name, `https://pod.test/view?filename=${name}.png&type=output`])) }
    await validateVideoPlan({ ...plan, profile: 'high-quality' })
    const original = await buildVideoGraph(plan, 'shot')
    assert.deepEqual(await buildVideoGraph({ ...plan, profile: 'standard' }, 'shot'), original)
    const high = await buildVideoGraph({ ...plan, profile: 'high-quality' }, 'shot')
    assert.deepEqual(high.graph, original.graph)
    assert.deepEqual(high.workflow, original.workflow)
    assert.equal(high.profile, 'high-quality')
    assert.equal(high.graph.n126.inputs.frame_rate, 48)
  }
}))

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
