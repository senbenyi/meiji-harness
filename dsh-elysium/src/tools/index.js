// 职责：组装运行时与 Web 工具，并提供 Agent 投影入口；不公开具体工具工厂。
import { createCallToolsProject } from './project/project.js'
import { createCallToolsDirectorList } from './project/director.js'
import { createCallToolsJobResult, createCallToolsJobStatus } from './task/model.js'
import { createCallToolsVideo, createCallToolsVideoRecover } from './media/video.js'
import { createCallToolsImage, createCallToolsImageRecover } from './media/image.js'
import { createCallToolsForAgent, createCallToolsWorkcard, isElysiumAgent, TOOL_GROUPS } from './agent/index.js'

export { createCallToolsForAgent }
// 组装与模型任务状态和结果查询相关的工具。
const createCallToolsJobs = () => [createCallToolsJobStatus(), createCallToolsJobResult()]
// 组装面向用户的图片与视频工具。
const createCallToolsMedia = () => [createCallToolsImage(), createCallToolsImageRecover(), createCallToolsVideo(), createCallToolsVideoRecover()]
// 组装依赖 Web Store 的导演与项目工具。
export const createCallToolsWeb = ({ projects, directors }) => [...createCallToolsDirectorList(directors), ...createCallToolsProject(projects)]
// 组装插件启动时注册的完整运行时工具清单。
export const createCallToolsRuntime = ctx => [createCallToolsLoad(ctx), ...createCallToolsMedia(), ...createCallToolsJobs()].map(createCallToolsWorkcard)

/*
 * 按需加载流程：
 * 1. Agent 调用 call_tools_load 并选择 TOOL_GROUPS 中的工具组。
 * 2. ctx.tools.schemas(exec.agent) 读取当前 Agent 已获授权的真实工具清单。
 * 3. 请求组与授权清单取交集，只返回 loaded_tools 名称；此处不执行工具，也不扩大权限。
 * 4. Harness 将本次 tool/call 和成功的 tool/result 写入会话事件。
 * 5. 下一轮 system-prompt/assemble 由 loadedToolNames 恢复名称，createCallToolsForAgent 再把对应原始 Schema 和说明投影给模型。
 * 因此“加载”本质是跨轮次恢复工具可见性，权限仍以 Harness 当前 Agent 的 Schema 为准。
 */
function createCallToolsLoad(ctx) {
  return {
    name: 'call_tools_load', description: '按需加载通用工具组及其原始参数和说明，不执行任务。加载后在下一次请求直接调用原工具。',
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
