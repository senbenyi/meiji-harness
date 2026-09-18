import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelTools, createComfyuiTools, createWorkflowTools, apply } from '../src/index.js'

test('registers workflow, job query and ComfyUI tools', async () => {
  const atomicRuntime = { ELYSIUM_ENABLE_ATOMIC_TOOLS: '1' }
  const expected = [
    'model_job_status',
    'model_job_result',
  ]
  assert.deepEqual(
    createModelTools().map(tool => tool.name),
    expected,
  )
  const workflows = createWorkflowTools().map(tool => tool.name)
  const all = ['elysium_load_tools', ...workflows, ...expected, ...createComfyuiTools(atomicRuntime).map(tool => tool.name)]
  assert.deepEqual(createComfyuiTools({ ELYSIUM_ENABLE_ATOMIC_TOOLS: '0' }), [])
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
  for (const tool of [...createWorkflowTools(), ...createModelTools(), ...createComfyuiTools({ ELYSIUM_ENABLE_ATOMIC_TOOLS: '1' })]) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
  for (const name of ['workflow_generate_image', 'workflow_generate_video']) {
    const tool = createWorkflowTools().find(tool => tool.name === name)
    assert.ok(!tool.parameters.required.includes('project_id'))
  }
  const video = createWorkflowTools().find(tool => tool.name === 'workflow_generate_video')
  assert.deepEqual(video.parameters.oneOf, [{ required: ['mode', 'prompt'] }, { required: ['duration'] }])
  assert.equal(video.parameters.anyOf, undefined)
})

test('injects creation guidance only for the three Elysium modes', async () => {
  let assemble
  apply({ inject() {}, on: (name, listener) => { if (name === 'system-prompt/assemble') assemble = listener }, tools: { register() {} } })
  const base = { tools: [], sections: [] }
  const agent = agentPreset => ({ session: { header: { agentPreset }, snapshotEvents: () => [] } })
  assert.deepEqual(await assemble({}, { agent: agent('elysium-standard') }, async () => base), base)
  for (const id of ['elysium-teaching', 'elysium-free', 'elysium-director']) {
    const result = await assemble({}, { agent: agent(id) }, async () => base)
    assert.deepEqual(result.sections.map(section => section.name), ['elysium:creation-commands'])
  }
})
