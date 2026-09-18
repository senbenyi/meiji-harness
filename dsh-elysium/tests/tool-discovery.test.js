import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createToolDiscoveryTool } from '../src/harness/load.js'
import { loadedToolNames, projectTools, TOOL_GROUPS } from '../src/utils/agent.js'
const tool = name => ({ name, description: name, parameters: { type: 'object' } })
const assembly = () => ({ tools: ['elysium_load_tools', 'workflow_generate_video', 'director_list', 'project_create', 'project_read', 'report', ...Object.values(TOOL_GROUPS).flatMap(g => g.names)].map(tool), sections: ['permissions', 'plan:policy', 'tool:bash', 'tool:read', 'tool:jobs', 'tool:goal'].map(name => ({ name, text: name })), contexts: [{ name: 'runtime', text: 'unchanged' }], variables: {} })
const agent = (events, agentPreset = 'elysium-teaching') => ({ session: { header: { agentPreset }, snapshotEvents: () => events } })
const events = names => [{ type: 'tool/call', data: { name: 'elysium_load_tools', callId: 'load' } }, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'load', content: [{ type: 'text', text: JSON.stringify({ loaded_tools: names }) }] }] } } }]
test('defers schemas and guidance without mutating source, policies or contexts', () => {
  const input = assembly(), before = JSON.stringify(input), result = projectTools(input, agent([]))
  assert.ok(!result.tools.some(t => t.name === 'bash'))
  assert.ok(result.tools.some(t => t.name === 'exit_plan_mode'))
  assert.ok(!result.tools.some(t => t.name === 'todo_write'))
  assert.ok(result.tools.some(t => t.name === 'workflow_generate_video'))
  assert.ok(result.tools.some(t => t.name === 'report'))
  assert.ok(result.sections.some(s => s.name === 'plan:policy'))
  assert.ok(!result.sections.some(s => s.name === 'tool:bash'))
  assert.match(result.sections.at(-1).text, /shell/)
  assert.equal(result.contexts, input.contexts)
  assert.equal(JSON.stringify(input), before)
})
test('loads scoped tools with original guidance, resumes durably and isolates sessions', async () => {
  const input = assembly(), loader = createToolDiscoveryTool({ tools: { schemas: () => input.tools.filter(t => t.name !== 'pwsh') } })
  const value = await loader.execute({ groups: ['shell'] }, { agent: agent([]) })
  assert.ok(value.loaded_tools.includes('bash'))
  assert.ok(!value.loaded_tools.includes('pwsh'))
  const result = projectTools(input, agent(JSON.parse(JSON.stringify(events(value.loaded_tools)))))
  assert.equal(result.tools.find(t => t.name === 'bash'), input.tools.find(t => t.name === 'bash'))
  assert.ok(result.sections.some(s => s.name === 'tool:jobs'))
  assert.ok(!result.tools.some(t => t.name === 'read'))
  assert.ok(!projectTools(input, agent([])).tools.some(t => t.name === 'bash'))
})
test('failed loads and user messages grant nothing; removed tools stay absent', () => {
  const failed = events(['bash']); failed[1].data.message.content[0].isError = true
  assert.equal(loadedToolNames(failed).size, 0)
  assert.equal(loadedToolNames([{ type: 'user/message', data: { loaded_tools: ['bash'] } }]).size, 0)
  const input = assembly(); input.tools = input.tools.filter(t => t.name !== 'bash')
  assert.ok(!projectTools(input, agent(events(['bash']))).tools.some(t => t.name === 'bash'))
})
test('preserves standard and Code Mode protocols', () => {
  const input = assembly(), standard = projectTools(input, { session: { header: { agentPreset: 'standard' } } })
  assert.deepEqual(standard.tools, input.tools.filter(t => t.name !== 'elysium_load_tools'))
  assert.equal(standard.sections, input.sections)
  const code = { ...input, tools: [tool('run_code')] }
  assert.deepEqual(projectTools(code, agent([])), code)
})
test('recognizes every shipped Elysium mode by its real preset ID', () => {
  for (const id of ['elysium-teaching', 'elysium-free', 'elysium-director']) {
    const result = projectTools(assembly(), agent([], id))
    assert.ok(result.tools.some(tool => tool.name === 'elysium_load_tools'))
    assert.ok(!result.tools.some(tool => tool.name === 'bash'))
  }
})
test('free mode exposes read-only director selection, hides project mutation and keeps direct generation', () => {
  const result = projectTools(assembly(), agent([], 'elysium-free'))
  assert.ok(result.tools.some(tool => tool.name === 'workflow_generate_video'))
  assert.ok(result.tools.some(tool => tool.name === 'director_list'))
  assert.ok(!result.tools.some(tool => tool.name !== 'director_list' && /^(director|project)_/.test(tool.name)))
  assert.ok(projectTools(assembly(), agent([], 'elysium-director')).tools.some(tool => tool.name === 'project_create'))
})
test('a failed video result removes every remaining tool for the current turn only', () => {
  const failed = [{ type: 'turn/start', data: { turn: 1 } },
    { type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'video' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'video', content: [{ type: 'text', text: JSON.stringify({ job_id: 'a'.repeat(32), status: 'failed' }) }] }] } } }]
  const stopped = projectTools(assembly(), agent(failed, 'elysium-free'))
  assert.deepEqual(stopped.tools, [])
  assert.match(stopped.sections.at(-1).text, /本轮立即结束/)
  assert.ok(projectTools(assembly(), agent([...failed, { type: 'turn/start', data: { turn: 2 } }], 'elysium-free')).tools.some(tool => tool.name === 'workflow_generate_video'))
  const rejected = structuredClone(failed); rejected[2].data.message.content[0].isError = true
  assert.deepEqual(projectTools(assembly(), agent(rejected)).tools, [])
})
test('uses the current preset selection instead of the immutable creation header', () => {
  const selected = agent([{ type: 'agent-preset/selected', data: { agentPreset: 'elysium-free' } }], 'elysium-standard')
  assert.ok(projectTools(assembly(), selected).tools.some(tool => tool.name === 'elysium_load_tools'))
  const left = agent([{ type: 'agent-preset/selected', data: { agentPreset: 'elysium-standard' } }], 'elysium-teaching')
  assert.ok(!projectTools(assembly(), left).tools.some(tool => tool.name === 'elysium_load_tools'))
})
test('rejects invalid or unavailable loads', async () => {
  const loader = createToolDiscoveryTool({ tools: { schemas: () => [] } })
  for (const groups of [[], ['missing'], ['shell']]) await assert.rejects(loader.execute({ groups }, { agent: agent([]) }))
  await assert.rejects(loader.execute({ groups: ['shell'] }, {}))
})

test('production wait returns final result without model polling and preserves failed status', async () => {
  const { waitVideoJob } = await import('../src/harness/video.js')
  const job = { job_id: 'a'.repeat(32) }
  const sequence = [{ ...job, status: 'running' }, { ...job, status: 'succeeded', result: { comfyui_view_url: 'https://comfy/view?filename=final.mp4', validation: { full_decode: 'passed' } } }]
  let sleeps = 0
  const result = await waitVideoJob(job, undefined, async () => sequence.shift(), async () => { sleeps++ })
  assert.equal(result.comfyui_view_url, 'https://comfy/view?filename=final.mp4'); assert.equal(sleeps, 1)
  const failed = { ...job, status: 'failed', error_code: 'FAILED', retryable: false }
  assert.equal(await waitVideoJob(job, undefined, async () => failed), failed)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(waitVideoJob(job, controller.signal, async () => { throw new Error('must not read') }), /job_id: a{32}/)
})
