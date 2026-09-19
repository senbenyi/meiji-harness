// 职责：call_tools_load 工具：按需恢复通用工具组的可见性，不执行任务、不扩大权限。
import { toolsConfig } from '../config.js'
import { isElysiumAgent } from '../session/index.js'

/*
 * 按需加载流程：
 * 1. Agent 调用 call_tools_load 并选择 toolsConfig 中的工具组。
 * 2. ctx.tools.schemas(exec.agent) 读取当前 Agent 已获授权的真实工具清单。
 * 3. 请求组与授权清单取交集，只返回 loaded_tools 名称；此处不执行工具，也不扩大权限。
 * 4. Harness 将本次 tool/call 和成功的 tool/result 写入会话事件。
 * 5. 下一轮 system-prompt/assemble 由 loadedToolNames 恢复名称，createCallToolsForAgent 再把对应原始 Schema 和说明投影给模型。
 * 因此“加载”本质是跨轮次恢复工具可见性，权限仍以 Harness 当前 Agent 的 Schema 为准。
 */
export function createCallToolsLoad(ctx) {
  return {
    name: 'call_tools_load', description: '按需加载通用工具组及其原始参数和说明，不执行任务。加载后在下一次请求直接调用原工具。',
    parameters: { type: 'object', additionalProperties: false, properties: {
        groups: { type: 'array', items: { type: 'string', enum: Object.keys(toolsConfig) } },
      }, required: ['groups'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
          loaded_tools: { type: 'array', items: { type: 'string' } },
        }, required: ['loaded_tools'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (!isElysiumAgent(exec?.agent)) throw new Error('工具加载仅适用于极乐世界预设')
      if (!Array.isArray(args.groups) || !args.groups.length || args.groups.some(group => !Object.hasOwn(toolsConfig, group))) throw new Error('无效工具组')
      const available = new Set(ctx.tools.schemas(exec.agent).map(tool => tool.name))
      const names = [...new Set(args.groups.flatMap(group => toolsConfig[group].names))].filter(name => available.has(name))
      if (!names.length) throw new Error('本会话没有可用的该组工具；加载不会扩大权限')
      return { loaded_tools: names }
    },
  }
}
