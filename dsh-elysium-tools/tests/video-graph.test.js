import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildVideoGraph, frameIndices, loadVideoTemplates, VIDEO_SETTINGS } from '../src/workflows/video-graph.js'

const templates = await loadVideoTemplates()

test('packaged workflows retain the editable canonical graphs and derive settings from them', async () => {
  for (const name of ['workflow_generate_video', 'workflow_director_video']) {
    const canonical = JSON.parse(await readFile(new URL(`../../../llm-ai-model/workflows/video-generate-minimax-h3/${name}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(templates[name].workflow, canonical)
    assert.equal(templates[name].settings.fps, 24)
    assert.equal(templates[name].settings.outputFps, 30)
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

function visualGraph(workflow) {
  const links = new Map(workflow.links.map(link => [link[0], link]))
  return Object.fromEntries(workflow.nodes.map(node => {
    const binding = node.properties.harness
    const values = Object.fromEntries(binding.widgets.map((name, index) => [name, node.widgets_values[index]]))
    const inputs = Object.fromEntries(binding.inputs.filter(name => name in values).map(name => [name, values[name]]))
    for (const port of node.inputs) if (port.link !== null) {
      const link = links.get(port.link)
      inputs[port.name] = [link[1], link[2]]
    }
    return [node.id, { class_type: node.type, inputs }]
  }))
}

test('single generation and multi-segment direction route by execution units, not prompt wording', () => {
  const single = buildVideoGraph({ duration: 5, prompts: ['three camera angles in one continuous video'] }, {}, templates, 'single')
  assert.equal(single.workflowName, 'workflow_generate_video')
  const directed = buildVideoGraph({ duration: 2, shots: [
    { id: 'a', duration: 1, prompt: 'A' }, { id: 'b', duration: 1, prompt: 'B', mode: 'continue' },
  ] }, {}, templates, 'directed')
  assert.equal(directed.workflowName, 'workflow_director_video')
  for (const result of [single, directed]) {
    const expected = Object.fromEntries(Object.entries(result.graph).map(([id, n]) => [id, { class_type: n.class_type, inputs: n.inputs }]))
    assert.deepEqual(visualGraph(result.workflow), expected)
    assert.ok(result.workflow.nodes.every(n => n.mode === 0))
    assert.equal(result.workflow.extra.harness.name, result.workflowName)
  }
})

test('reference, first-frame generation and reuse all have faithful visual execution graphs', () => {
  const media = { video: { name: 'upload.mp4', fps: 25, duration: 2, hasAudio: false }, image: { name: 'upload.png' } }
  for (const plan of [
    { duration: 1, prompts: ['A'], image_prompt: 'a real first frame' },
    { duration: 1, shots: [{ id: 'ref', mode: 'reference', duration: 1, prompt: 'reference', image_path: 'image' }] },
    { duration: 1, shots: [{ id: 'reuse', mode: 'reuse', duration: 1, video_path: 'video' }] },
  ]) {
    const result = buildVideoGraph(plan, media, templates, 'variants')
    if (plan.image_prompt) {
      assert.equal(result.graph.first_4.inputs.width, 768)
      assert.equal(result.graph.first_4.inputs.height, 1152)
      assert.equal(result.graph.first_5.inputs.steps, 20)
      assert.equal(result.graph.first_5.inputs.cfg, 5)
    }
    assert.deepEqual(visualGraph(result.workflow), Object.fromEntries(Object.entries(result.graph).map(([id, n]) => [id, { class_type: n.class_type, inputs: n.inputs }])))
  }
})

test('editing visual source parameters changes execution without hard-coded node defaults', () => {
  const changed = structuredClone(templates)
  const bundle = changed.workflow_generate_video
  bundle.graph.s0_sampler.inputs.sampler_name = 'heun'
  bundle.graph.s0_resize.inputs.upscale_method = 'bicubic'
  const { graph } = buildVideoGraph({ duration: 1, prompts: ['A'] }, {}, changed, 'edited')
  assert.equal(graph.s0_sampler.inputs.sampler_name, 'heun')
  assert.equal(graph.s0_resize.inputs.upscale_method, 'bicubic')
})
