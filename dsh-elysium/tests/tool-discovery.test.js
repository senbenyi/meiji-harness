import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { toolsConfig } from '../src/config.js'
import { createCallToolsRuntime } from '../src/tools/index.js'
import { createCallToolsForAgent, loadedToolNames } from '../src/session/index.js'
const tool = name => ({ name, description: name, parameters: { type: 'object' } })
const assembly = () => ({ tools: ['call_tools_load', 'call_tools_video', 'call_tools_director_list', 'call_tools_project_create', 'call_tools_project_read', 'report', ...Object.values(toolsConfig).flatMap(g => g.names)].map(tool), sections: ['permissions', 'plan:policy', 'tool:bash', 'tool:read', 'tool:jobs', 'tool:goal'].map(name => ({ name, text: name })), contexts: [{ name: 'runtime', text: 'unchanged' }], variables: {} })
const agent = (events, agentPreset = 'elysium-free') => ({ session: { header: { agentPreset }, snapshotEvents: () => events } })
const events = names => [{ type: 'tool/call', data: { name: 'call_tools_load', callId: 'load' } }, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'load', content: [{ type: 'text', text: JSON.stringify({ loaded_tools: names }) }] }] } } }]
const discoveryTool = schemas => createCallToolsRuntime({ tools: { schemas } }).find(tool => tool.name === 'call_tools_load')
test('loads tool groups and discovery schema from config', () => {
  const config = JSON.parse(readFileSync(new URL('../config/tools.json', import.meta.url), 'utf8'))
  assert.deepEqual(toolsConfig, config)
  assert.deepEqual(discoveryTool(() => []).parameters.properties.groups.items.enum, Object.keys(config))
})
test('defers schemas and guidance without mutating source, policies or contexts', () => {
  const input = assembly(), before = JSON.stringify(input), result = createCallToolsForAgent(input, agent([]))
  assert.ok(!result.tools.some(t => t.name === 'bash'))
  assert.ok(result.tools.some(t => t.name === 'exit_plan_mode'))
  assert.ok(!result.tools.some(t => t.name === 'todo_write'))
  assert.ok(result.tools.some(t => t.name === 'call_tools_video'))
  assert.ok(result.tools.some(t => t.name === 'report'))
  assert.ok(result.sections.some(s => s.name === 'plan:policy'))
  assert.ok(!result.sections.some(s => s.name === 'tool:bash'))
  assert.match(result.sections.find(section => section.name === 'elysium:tool-discovery').text, /shell/)
  assert.ok(result.sections.some(section => section.name === 'elysium:creation-policy'))
  assert.equal(result.contexts, input.contexts)
  assert.equal(JSON.stringify(input), before)
})
test('loads scoped tools with original guidance, resumes durably and isolates sessions', async () => {
  const input = assembly(), loader = discoveryTool(() => input.tools.filter(t => t.name !== 'pwsh'))
  const value = await loader.execute({ groups: ['shell'] }, { agent: agent([]) })
  assert.ok(value.loaded_tools.includes('bash'))
  assert.ok(!value.loaded_tools.includes('pwsh'))
  const result = createCallToolsForAgent(input, agent(JSON.parse(JSON.stringify(events(value.loaded_tools)))))
  assert.equal(result.tools.find(t => t.name === 'bash'), input.tools.find(t => t.name === 'bash'))
  assert.ok(result.sections.some(s => s.name === 'tool:jobs'))
  assert.ok(!result.tools.some(t => t.name === 'read'))
  assert.ok(!createCallToolsForAgent(input, agent([])).tools.some(t => t.name === 'bash'))
})
test('failed loads and user messages grant nothing; removed tools stay absent', () => {
  const failed = events(['bash']); failed[1].data.message.content[0].isError = true
  assert.equal(loadedToolNames(failed).size, 0)
  assert.equal(loadedToolNames([{ type: 'user/message', data: { loaded_tools: ['bash'] } }]).size, 0)
  const input = assembly(); input.tools = input.tools.filter(t => t.name !== 'bash')
  assert.ok(!createCallToolsForAgent(input, agent(events(['bash']))).tools.some(t => t.name === 'bash'))
})
test('preserves standard and Code Mode protocols', () => {
  const input = assembly(), standard = createCallToolsForAgent(input, { session: { header: { agentPreset: 'standard' } } })
  assert.deepEqual(standard.tools, input.tools.filter(t => t.name !== 'call_tools_load' && !/^call_tools_(project|director)_/.test(t.name)))
  assert.equal(standard.sections, input.sections)
  const code = { ...input, tools: [tool('run_code')] }
  const projectedCode = createCallToolsForAgent(code, agent([]))
  assert.deepEqual(projectedCode.tools, code.tools)
  assert.ok(projectedCode.sections.some(section => section.name === 'elysium:creation-policy'))
})
test('recognizes the shipped Elysium preset by its real ID', () => {
  for (const id of ['elysium-free']) {
    const result = createCallToolsForAgent(assembly(), agent([], id))
    assert.ok(result.tools.some(tool => tool.name === 'call_tools_load'))
    assert.ok(!result.tools.some(tool => tool.name === 'bash'))
  }
})
test('project and director tools never appear in chat, including old loaded sessions', async () => {
  const input = assembly()
  const result = createCallToolsForAgent(input, agent([], 'elysium-free'))
  assert.ok(result.tools.some(tool => tool.name === 'call_tools_video'))
  assert.ok(!result.tools.some(tool => /^call_tools_(director|project)_/.test(tool.name)))
  const loader = discoveryTool(() => assembly().tools)
  await assert.rejects(loader.execute({ groups: ['project'] }, { agent: agent([]) }))
  for (const current of [agent(events(['call_tools_project_create', 'call_tools_director_list'])), { session: { header: { agentPreset: 'standard' } } }]) {
    const visible = createCallToolsForAgent(input, current)
    assert.ok(!visible.tools.some(tool => /^call_tools_(director|project)_/.test(tool.name)))
  }
  assert.doesNotMatch(result.sections.find(section => section.name === 'elysium:creation-policy').text, /加载 project|新建项目/)
})
test('a failed video result removes every remaining tool for the current turn but input validation can retry once', () => {
  const failed = [{ type: 'turn/start', data: { turn: 1 } },
    { type: 'tool/call', data: { name: 'call_tools_video', callId: 'video' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'video', content: [{ type: 'text', text: JSON.stringify({ job_id: 'a'.repeat(32), status: 'failed' }) }] }] } } }]
  const stopped = createCallToolsForAgent(assembly(), agent(failed, 'elysium-free'))
  assert.deepEqual(stopped.tools, [])
  assert.match(stopped.sections.find(section => section.name === 'elysium:video-failed-stop').text, /本轮立即结束/)
  assert.ok(createCallToolsForAgent(assembly(), agent([...failed, { type: 'turn/start', data: { turn: 2 } }], 'elysium-free')).tools.some(tool => tool.name === 'call_tools_video'))
  const rejected = structuredClone(failed); rejected[2].data.message.content[0].isError = true
  assert.deepEqual(createCallToolsForAgent(assembly(), agent(rejected)).tools, [])
  const inputInvalid = structuredClone(rejected)
  inputInvalid[2].data.message.content[0].content = [{ type: 'text', text: 'Error: [MODEL_INPUT_INVALID] duration 参数无效' }]
  assert.ok(createCallToolsForAgent(assembly(), agent(inputInvalid)).tools.some(tool => tool.name === 'call_tools_video'))
  const secondInvalid = structuredClone(inputInvalid)
  secondInvalid.push({ type: 'tool/call', data: { name: 'call_tools_video', callId: 'video-2' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'video-2', isError: true,
      content: [{ type: 'text', text: 'Error: [MODEL_INPUT_INVALID] shots 参数无效' }] }] } } })
  assert.deepEqual(createCallToolsForAgent(assembly(), agent(secondInvalid)).tools, [])
})
test('uses the current preset selection instead of the immutable creation header', () => {
  const selected = agent([{ type: 'agent-preset/selected', data: { agentPreset: 'elysium-free' } }], 'elysium-standard')
  assert.ok(createCallToolsForAgent(assembly(), selected).tools.some(tool => tool.name === 'call_tools_load'))
  const left = agent([{ type: 'agent-preset/selected', data: { agentPreset: 'elysium-standard' } }], 'elysium-free')
  assert.ok(!createCallToolsForAgent(assembly(), left).tools.some(tool => tool.name === 'call_tools_load'))
})
test('rejects invalid or unavailable loads', async () => {
  const loader = discoveryTool(() => [])
  for (const groups of [[], ['missing'], ['shell']]) await assert.rejects(loader.execute({ groups }, { agent: agent([]) }))
  await assert.rejects(loader.execute({ groups: ['shell'] }, {}))
})

test('production wait returns final result without model polling and preserves failed status', async () => {
  const { waitJob } = await import('../src/worker/runner/wait.js')
  const job = { job_id: 'a'.repeat(32) }
  const sequence = [{ ...job, status: 'running' }, { ...job, status: 'succeeded', result: { comfyui_view_url: 'https://comfy/view?filename=final.mp4', validation: { full_decode: 'passed' } } }]
  let sleeps = 0
  const result = await waitJob(job, undefined, async () => sequence.shift(), async () => { sleeps++ })
  assert.equal(result.comfyui_view_url, 'https://comfy/view?filename=final.mp4'); assert.equal(sleeps, 1)
  const failed = { ...job, status: 'failed', error_code: 'FAILED', retryable: false }
  assert.equal(await waitJob(job, undefined, async () => failed), failed)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(waitJob(job, controller.signal, async () => { throw new Error('must not read') }), /job_id: a{32}/)
})
