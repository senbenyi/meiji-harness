// 职责：定义由 Harness 注册的通用工具组加载入口，不负责会话工具投影。
import { isElysiumAgent, TOOL_GROUPS } from '../agent/index.js'

// 创建工具发现定义：校验请求组，并仅返回当前 Agent 本来就有权限使用的工具名称。
export function createToolDiscoveryTool(ctx) {
  return {
    name: 'elysium_load_tools', description: '按需加载通用工具组及其原始参数和说明，不执行任务。加载后在下一次请求直接调用原工具。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      groups: { type: 'array', items: { type: 'string', enum: Object.keys(TOOL_GROUPS) } },
    }, required: ['groups'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      loaded_tools: { type: 'array', items: { type: 'string' } },
    }, required: ['loaded_tools'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (!isElysiumAgent(exec?.agent)) throw new Error('工具加载仅适用于极乐世界预设')
      if (!Array.isArray(args.groups) || !args.groups.length || args.groups.some(group => !Object.hasOwn(TOOL_GROUPS, group))) throw new Error('无效工具组')
      const available = new Set(ctx.tools.schemas(exec.agent).map(tool => tool.name))
      const names = [...new Set(args.groups.flatMap(group => TOOL_GROUPS[group].names))].filter(name => available.has(name))
      if (!names.length) throw new Error('本会话没有可用的该组工具；加载不会扩大权限')
      return { loaded_tools: names }
    },
  }
}
