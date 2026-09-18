// 职责：根据 Agent 类型和会话状态投影本次请求可见的工具与提示词；不注册或执行工具。
import { toolsConfig } from '../../config.js'
import { loadedToolNames, videoFailedThisTurn } from './events.js'
import { isElysiumAgent, isElysiumProjectAgent } from './presets.js'
import { creationInstructions } from './creation.js'

// 可按需加载的 Harness 通用工具组由发布配置声明；这里只消费配置，不改变工具权限。
const deferred = new Set(Object.values(toolsConfig).flatMap(group => group.names))
const alwaysVisible = new Set(['exit_plan_mode'])
const sectionTools = { 'tool:jobs': toolsConfig.shell.names, 'tool:goal': toolsConfig.planning.names }
const projectTool = name => /^call_tools_(director|project)_/.test(name)
const withCreationInstructions = assembly => ({ ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'elysium:creation-commands'),
  { name: 'elysium:creation-commands', text: creationInstructions }] })

// 按预设、已加载工具和本轮失败状态生成本次请求实际可见的工具与提示词。
export function createCallToolsForAgent(assembly, agent) {
  if (!isElysiumAgent(agent)) {
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'call_tools_load') }
  }
  if (assembly.tools.some(tool => tool.name === 'run_code')) return withCreationInstructions({ ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'call_tools_load') })
  const events = agent.session.snapshotEvents()
  if (videoFailedThisTurn(events)) return withCreationInstructions({ ...assembly, tools: [], sections: [...assembly.sections,
    { name: 'elysium:video-failed-stop', text: '视频任务已失败。本轮立即结束并报告失败；等待用户新消息明确要求重试，不得继续调用任何工具。' }] })
  const loaded = loadedToolNames(events)
  const project = isElysiumProjectAgent(agent)
  const tools = assembly.tools.filter(tool => (project || tool.name === 'call_tools_director_list' || !projectTool(tool.name)) && (!deferred.has(tool.name) || alwaysVisible.has(tool.name) || loaded.has(tool.name)))
  const visible = new Set(tools.map(tool => tool.name))
  const available = new Set(assembly.tools.map(tool => tool.name))
  const catalog = Object.entries(toolsConfig).flatMap(([id, group]) => {
    const names = group.names.filter(name => available.has(name) && !visible.has(name))
    return names.length ? [`${id}: ${group.description} (${names.join(', ')})`] : []
  })
  const sections = assembly.sections.filter(section => {
    const names = sectionTools[section.name] || (section.name.startsWith('tool:') ? [section.name.slice(5)] : [])
    // Unknown sections and all permission/plan policies stay intact.
    return !names.some(name => deferred.has(name)) || names.some(name => visible.has(name))
  })
  if (catalog.length) sections.push({ name: 'elysium:tool-discovery', text:
    `通用能力仍可用；先用 call_tools_load 加载所需组，再调用原工具。无需切换预设。已加载工具在本会话保留。\n${catalog.join('\n')}` })
  return withCreationInstructions({ ...assembly, tools, sections })
}
