import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createModelTools, createComfyuiTools, apply } from '../src/index.js'

test('registers endpoint, job query and ComfyUI tools declared by the manifest', async () => {
  const expected = [
    'model_generate_image',
    'model_generate_video_long',
    'model_generate_video',
    'model_concat_video',
    'model_generate_dialogue',
    'model_interpolate_video',
    'model_upscale_video',
    'model_generate_video_audio',
    'model_job_status',
    'model_job_result',
  ]
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    createModelTools().map(tool => tool.name),
    expected,
  )
  const all = [...expected, ...createComfyuiTools().map(tool => tool.name)]
  assert.deepEqual(manifest.contributes.tools, all)
  const registered = []
  apply({ tools: { register: tool => registered.push(tool.name) } })
  assert.deepEqual(registered, all)
})

test('all tools expose function-call schemas and local executors', () => {
  for (const tool of [...createModelTools(), ...createComfyuiTools()]) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
})
