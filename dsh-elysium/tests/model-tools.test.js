import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelTools, createComfyuiTools, createWorkflowTools, apply } from '../src/index.js'

test('registers workflow, job query and ComfyUI tools', async () => {
  const expected = [
    'model_job_status',
    'model_job_result',
  ]
  assert.deepEqual(
    createModelTools().map(tool => tool.name),
    expected,
  )
  const workflows = createWorkflowTools().map(tool => tool.name)
  const all = ['elysium_load_tools', ...workflows, ...expected, ...createComfyuiTools().map(tool => tool.name)]
  const registered = []
  const previous = process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS
  try {
    delete process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS
    apply({ inject() {}, on() {}, tools: { register: tool => registered.push(tool.name) } })
    assert.deepEqual(registered, ['elysium_load_tools', ...workflows, ...expected])
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
