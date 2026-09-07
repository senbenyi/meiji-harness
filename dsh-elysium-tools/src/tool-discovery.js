// Keep execution/permissions in Harness; only defer known native tool schemas and guidance.
export const TOOL_GROUPS = {
  files: { description: '读取、编辑和搜索文件', names: ['read', 'read_image', 'write', 'edit', 'glob', 'grep'] },
  shell: { description: 'Shell 与后台进程管理', names: ['bash', 'pwsh', 'job_list', 'job_output', 'job_kill'] },
  planning: { description: '计划、目标和待办管理', names: ['create_goal', 'get_goal', 'update_goal', 'exit_plan_mode', 'todo_write'] },
  agents: { description: '子代理协作', names: ['subagent', 'subagent_fork', 'list_agents', 'send_message', 'interrupt_agent'] },
  orchestration: { description: '通用多代理工作流和 Ralph 循环（仅用户明确要求时）', names: ['workflow', 'ralph'] },
}
const deferred = new Set(Object.values(TOOL_GROUPS).flatMap(group => group.names))
const sectionTools = { 'tool:jobs': TOOL_GROUPS.shell.names, 'tool:goal': TOOL_GROUPS.planning.names }
const isElysium = agent => agent?.session?.header?.agentPreset === 'elysium'

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
  if (!isElysium(agent) || assembly.tools.some(tool => tool.name === 'run_code')) {
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'elysium_load_tools') }
  }
  const loaded = loadedToolNames(agent.session.events)
  const tools = assembly.tools.filter(tool => !deferred.has(tool.name) || loaded.has(tool.name))
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

export function createToolDiscoveryTool(ctx) {
  return {
    name: 'elysium_load_tools', description: '按需加载通用工具组及其原始参数和说明，不执行任务。加载后在下一次请求直接调用原工具。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      groups: { type: 'array', minItems: 1, items: { type: 'string', enum: Object.keys(TOOL_GROUPS) } },
    }, required: ['groups'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      loaded_tools: { type: 'array', items: { type: 'string' } },
    }, required: ['loaded_tools'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (!isElysium(exec?.agent)) throw new Error('工具加载仅适用于极乐世界预设')
      if (!Array.isArray(args.groups) || !args.groups.length || args.groups.some(group => !Object.hasOwn(TOOL_GROUPS, group))) throw new Error('无效工具组')
      const available = new Set(ctx.tools.schemas(exec.agent).map(tool => tool.name))
      const names = [...new Set(args.groups.flatMap(group => TOOL_GROUPS[group].names))].filter(name => available.has(name))
      if (!names.length) throw new Error('本会话没有可用的该组工具；加载不会扩大权限')
      return { loaded_tools: names }
    },
  }
}
