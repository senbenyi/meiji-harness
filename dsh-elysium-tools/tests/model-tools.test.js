import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createModelTools, createWorkflowTools } from '../src/index.js'

test('registers the model and workflow tools declared by the manifest', async () => {
  const expected = [
    'model_generate_image',
    'model_generate_long_video',
    'model_generate_minimax_h3_t2va',
    'model_generate_minimax_h3_fl2va',
    'model_generate_minimax_h3_ref2va',
    'model_interpolate_video',
    'model_upscale_video',
    'model_add_video_audio',
    'model_job_status',
    'model_job_result',
    'workflow_adult_short_video',
  ]
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    [...createModelTools(), ...createWorkflowTools()].map(tool => tool.name),
    expected,
  )
  assert.deepEqual(manifest.contributes.tools, expected)
})

test('all tools expose function-call schemas and local executors', () => {
  for (const tool of [...createModelTools(), ...createWorkflowTools()]) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
})
