import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildVideoGraph, frameIndices, loadVideoTemplates, VIDEO_SETTINGS } from '../src/workflows/video-graph.js'

const templates = await loadVideoTemplates()

test('packaged execution graphs are the C-MMH3-18 exports, without runtime repository reads', async () => {
  for (const mode of ['text', 'image', 'reference']) {
    const canonical = JSON.parse(await readFile(new URL(`../../../llm-ai-model/workflows/video-production/h3-${mode}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(templates[mode], canonical)
    assert.match(templates[mode].director._meta.title, /C-MMH3-18/)
  }
})

test('24-to-30 conversion preserves presentation time and VFR input timestamps', () => {
  const indices = frameIndices(5, 30, { fps: 24 })
  assert.equal(indices.length, 150)
  assert.equal(indices.at(-1), 119)
  assert.deepEqual(frameIndices(0.2, 30, { timestamps: [0, 0.05, 0.1, 0.18] }), [0, 0, 1, 2, 2, 2])
})

test('three-shot graph retains prompts, per-shot durations, references, real last-frame dependency and final audio', () => {
  const plan = { duration: 15, shots: [
    { id: 'opening', duration: 5, prompt: '原始完整台词', image_path: '/local/first.png' },
    { id: 'reference', mode: 'reference', duration: 5, prompt: '保持人物与声音', video_path: '/local/ref.mp4' },
    { id: 'ending', mode: 'continue', duration: 5, prompt: '接续前镜头' },
  ] }
  const { graph, shots } = buildVideoGraph(plan, { '/local/first.png': { name: 'uploaded.png' }, '/local/ref.mp4': { name: 'uploaded.mp4' } }, templates, 'test')
  assert.deepEqual(shots, plan.shots)
  assert.equal(graph.s0_director.inputs.prompt, plan.shots[0].prompt)
  assert.equal(graph.s0_director.inputs.frame_rate, 24)
  assert.equal(graph.final.inputs.frame_rate, 30)
  assert.equal(graph.s2_conditioning.class_type, 'MiniMaxH3ImageToVideo')
  assert.deepEqual(graph.s2_conditioning.inputs.first_frame, ['s1_frame_149', 0])
  assert.equal(graph.s1_frame_149.inputs.batch_index, 119)
  assert.equal(JSON.parse(graph.s1_director.inputs.timeline_data).items[0].value, 'uploaded.mp4')
  assert.ok(!JSON.stringify(graph).includes('/local/'))
  assert.ok(graph.final.inputs.audio)
  assert.deepEqual(graph.s0_noise.inputs.seed_value, 666)
  for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
    if (Array.isArray(value)) assert.ok(graph[value[0]], `dangling link ${value}`)
  }
})

test('reuse fails if a requested cut exceeds source footage', () => {
  assert.throws(() => buildVideoGraph({ duration: 3, shots: [{ id: 'a', mode: 'reuse', video_path: 'a', duration: 3 }] },
    { a: { name: 'a.mp4', duration: 1, fps: 24 } }, templates, 'test'), /时长不足/)
})

test('generation and final-output dimensions preserve the current runtime configuration', async () => {
  const runtime = await readFile(new URL('../../../llm-ai-model/config/runtime.yaml', import.meta.url), 'utf8')
  assert.ok(runtime.includes(`resolution: [${VIDEO_SETTINGS.width}, ${VIDEO_SETTINGS.height}]`))
  assert.ok(runtime.includes(`resolution: [${VIDEO_SETTINGS.outputWidth}, ${VIDEO_SETTINGS.outputHeight}]`))
})
