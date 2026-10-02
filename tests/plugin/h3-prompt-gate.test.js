import assert from 'node:assert/strict'
import test from 'node:test'
import { createH3PromptGate, h3HasSection } from '../../lib/hooks/h3-prompt-gate.js'

const nextValue = { kind: 'continue' }
const next = async () => nextValue

function listenerFor(manifestId = 'minimax-h3-ref2v-quality') {
  const { makeH3PromptGateListener } = createH3PromptGate({
    videoShapes: {
      r2v: { capability: 'video.reference2video' },
      i2v: { capability: 'video.image2video' },
    },
    getRegistry: () => ({}),
    resolveManifest: () => ({ id: manifestId }),
  })
  return makeH3PromptGateListener()
}

test('H3 gate 只拒绝字段残缺的半结构化 prompt', async () => {
  const listener = listenerFor()
  assert.equal(h3HasSection('summary: test', 'summary'), true)
  assert.equal(await listener({ name: 'unrelated', arguments: {} }, next), nextValue)
  assert.equal(await listener({ name: 'comfy_generate_video', arguments: { type: 'r2v', prompt: '自由格式镜头描述' } }, next), nextValue)

  const denied = await listener({
    name: 'comfy_generate_video',
    arguments: { type: 'r2v', prompt: 'subject_definitions: fox\nsummary: run' },
  }, next)
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /retention_analysis/)

  const complete = [
    'subject_definitions: fox',
    'summary: run',
    'retention_analysis: keep fox',
    'detailed_description: forest',
    'overall_soundscape: wind',
    'non_diegetic_music: none',
  ].join('\n')
  assert.equal(await listener({ name: 'comfy_generate_video', arguments: { type: 'r2v', prompt: complete } }, next), nextValue)
})

test('H3 i2v 要求对齐指令，非 H3 工作流直接放行', async () => {
  const prompt = [
    'integrated_multimodal_description: fox runs',
    'overall_soundscape: wind',
    'non_diegetic_music: none',
  ].join('\n')
  const denied = await listenerFor()({
    name: 'comfy_generate_video',
    arguments: { type: 'i2v', prompt, first_frame_node: 'frame-1' },
  }, next)
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /对齐指令/)

  assert.equal(await listenerFor('other-video-workflow')({
    name: 'comfy_generate_video',
    arguments: { type: 'i2v', prompt, first_frame_node: 'frame-1' },
  }, next), nextValue)
})
