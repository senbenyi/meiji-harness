import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/index.js'
import { createRuntimeTools } from '../src/tools/index.js'

test('registers workflow and job query tools', async () => {
  const expected = ['elysium_load_tools',
    'workflow_generate_image',
    'workflow_resume_image',
    'workflow_generate_video',
    'workflow_resume_video',
    'model_character_view',
    'model_character_sheet',
    'model_job_status',
    'model_job_result',
  ]
  assert.deepEqual(createRuntimeTools({}).map(tool => tool.name), expected)
  const registered = []
  apply({ inject() {}, on() {}, tools: { register: tool => registered.push(tool.name) } })
  assert.deepEqual(registered, expected)
})

test('all tools expose function-call schemas and local executors', () => {
  const tools = createRuntimeTools({})
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
  for (const name of ['workflow_generate_image', 'workflow_generate_video']) {
    const tool = tools.find(tool => tool.name === name)
    assert.ok(!tool.parameters.required.includes('project_id'))
  }
  const video = tools.find(tool => tool.name === 'workflow_generate_video')
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
