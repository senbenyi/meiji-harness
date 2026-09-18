// 职责：按 Agent 会话投影可见工具与提示词；不定义或执行 Harness 工具。
export const TOOL_GROUPS = {
  files: { description: '读取、编辑和搜索文件', names: ['read', 'read_image', 'write', 'edit', 'glob', 'grep'] },
  shell: { description: 'Shell 与后台进程管理', names: ['bash', 'pwsh', 'job_list', 'job_output', 'job_kill'] },
  planning: { description: '计划、目标和待办管理', names: ['create_goal', 'get_goal', 'update_goal', 'exit_plan_mode', 'todo_write'] },
  agents: { description: '子代理协作', names: ['subagent', 'subagent_fork', 'list_agents', 'send_message', 'interrupt_agent'] },
  orchestration: { description: '通用多代理工作流和 Ralph 循环（仅用户明确要求时）', names: ['workflow', 'ralph'] },
}
const deferred = new Set(Object.values(TOOL_GROUPS).flatMap(group => group.names))
const alwaysVisible = new Set(['exit_plan_mode'])
const sectionTools = { 'tool:jobs': TOOL_GROUPS.shell.names, 'tool:goal': TOOL_GROUPS.planning.names }
export const ELYSIUM_AGENT_PRESETS = new Set(['elysium-teaching', 'elysium-free', 'elysium-director'])
export const currentAgentPreset = agent => {
  let preset = agent?.session?.header?.agentPreset
  for (const event of agent?.session?.snapshotEvents?.() || []) if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
  return preset
}
export const isElysiumAgent = agent => ELYSIUM_AGENT_PRESETS.has(currentAgentPreset(agent))
export const isElysiumFreeAgent = agent => currentAgentPreset(agent) === 'elysium-free'

function videoFailedThisTurn(events) {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const calls = new Set()
  for (const event of events.slice(turnStart + 1)) {
    if (event.type === 'tool/call' && ['workflow_generate_video', 'workflow_resume_video'].includes(event.data.name)) calls.add(event.data.callId)
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      if (block.type !== 'tool-result' || !calls.has(block.toolCallId)) continue
      if (block.isError) return true
      for (const item of block.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text), result = value.output || value
          if (result.status === 'failed' || result.status === 'rejected') return true
        } catch { /* Unrelated text is not a failed video result. */ }
      }
    }
  }
  return false
}

// Successful tool results are durable and replayed on resume/fork; user text cannot load tools.
export function loadedToolNames(events = []) {
  const calls = new Set()
  const loaded = new Set()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === 'elysium_load_tools') calls.add(event.data.callId)
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      if (block.type !== 'tool-result' || block.isError || !calls.has(block.toolCallId)) continue
      for (const item of block.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          for (const name of value.loaded_tools || []) if (typeof name === 'string') loaded.add(name)
        } catch { /* An unrelated or malformed result grants nothing. */ }
      }
    }
  }
  return loaded
}

export function projectTools(assembly, agent) {
  if (!isElysiumAgent(agent) || assembly.tools.some(tool => tool.name === 'run_code')) {
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'elysium_load_tools') }
  }
  const events = agent.session.snapshotEvents()
  if (videoFailedThisTurn(events)) return { ...assembly, tools: [], sections: [...assembly.sections,
    { name: 'elysium:video-failed-stop', text: '视频任务已失败。本轮立即结束并报告失败；等待用户新消息明确要求重试，不得继续调用任何工具。' }] }
  const loaded = loadedToolNames(events)
  const free = isElysiumFreeAgent(agent)
  const tools = assembly.tools.filter(tool => (!free || !/^(director|project)_/.test(tool.name)) && (!deferred.has(tool.name) || alwaysVisible.has(tool.name) || loaded.has(tool.name)))
  const visible = new Set(tools.map(tool => tool.name))
  const available = new Set(assembly.tools.map(tool => tool.name))
  const catalog = Object.entries(TOOL_GROUPS).flatMap(([id, group]) => {
    const names = group.names.filter(name => available.has(name) && !visible.has(name))
    return names.length ? [`${id}: ${group.description} (${names.join(', ')})`] : []
  })
  const sections = assembly.sections.filter(section => {
    const names = sectionTools[section.name] || (section.name.startsWith('tool:') ? [section.name.slice(5)] : [])
    // Unknown sections and all permission/plan policies stay intact.
    return !names.some(name => deferred.has(name)) || names.some(name => visible.has(name))
  })
  if (catalog.length) sections.push({ name: 'elysium:tool-discovery', text:
    `通用能力仍可用；先用 elysium_load_tools 加载所需组，再调用原工具。无需切换预设。已加载工具在本会话保留。\n${catalog.join('\n')}` })
  return { ...assembly, tools, sections }
}
