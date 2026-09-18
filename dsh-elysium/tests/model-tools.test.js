import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/index.js'
import { createRuntimeCallTools } from '../src/tools/index.js'

test('registers workflow and job query tools', async () => {
  const expected = ['call_tools_load',
    'call_tools_image',
    'call_tools_image_recover',
    'call_tools_video',
    'call_tools_video_recover',
    'call_tools_job_status',
    'call_tools_job_result',
  ]
  assert.deepEqual(createRuntimeCallTools({}).map(tool => tool.name), expected)
  const registered = []
  apply({ inject() {}, on() {}, tools: { register: tool => registered.push(tool.name) } })
  assert.deepEqual(registered, expected)
})

test('all tools expose function-call schemas and local executors', () => {
  const tools = createRuntimeCallTools({})
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
  }
  for (const name of ['call_tools_image', 'call_tools_video']) {
    const tool = tools.find(tool => tool.name === name)
    assert.ok(!tool.parameters.required.includes('project_id'))
  }
  const video = tools.find(tool => tool.name === 'call_tools_video')
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
