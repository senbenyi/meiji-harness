import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createModelTools, createComfyuiTools, createWorkflowTools, apply } from '../src/index.js'

test('registers endpoint, job query and ComfyUI tools declared by the manifest', async () => {
  const expected = [
    'model_generate_image',
    'model_generate_video_long',
    'model_generate_video',
    'model_concat_video',
    'model_job_status',
    'model_job_result',
  ]
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    createModelTools().map(tool => tool.name),
    expected,
  )
  const workflows = createWorkflowTools().map(tool => tool.name)
  const all = ['elysium_load_tools', ...workflows, ...expected, ...createComfyuiTools().map(tool => tool.name)]
  assert.deepEqual(manifest.contributes.tools, all)
  const registered = []
  const previous = process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS
  try {
    delete process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS
    apply({ inject() {}, on() {}, tools: { register: tool => registered.push(tool.name) } })
    assert.deepEqual(registered, ['elysium_load_tools', ...workflows, 'model_generate_image', 'model_concat_video', 'model_job_status', 'model_job_result'])
    registered.length = 0
    process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS = '1'
    apply({ inject() {}, on() {}, tools: { register: tool => registered.push(tool.name) } })
    assert.deepEqual(registered, all)
  } finally {
    if (previous === undefined) delete process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS
    else process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS = previous
  }
})

test('all tools expose function-call schemas and local executors', () => {
  for (const tool of [...createWorkflowTools(), ...createModelTools(), ...createComfyuiTools()]) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
})
