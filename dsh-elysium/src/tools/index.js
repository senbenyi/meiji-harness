// 职责：组装运行时与 Web 工具，并提供 Agent 投影入口；不公开具体工具工厂。
import { createCharacterTools } from './media/character.js'
import { createProjectTools } from './project/project.js'
import { createDirectorTools } from './project/director.js'
import { createModelJobResultTool, createModelJobStatusTool } from './task/model.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './media/video.js'
import { createWorkflowGenerateImageTool, createWorkflowResumeImageTool } from './media/image.js'
import { isElysiumAgent, projectAssemblyForAgent, TOOL_GROUPS, withWorkcardOutput } from './agent/index.js'

export { projectAssemblyForAgent }
// 组装与模型任务状态和结果查询相关的工具。
const createModelTools = () => [createModelJobStatusTool(), createModelJobResultTool()]
// 组装面向用户的图片、视频与角色工作流工具。
const createWorkflowTools = () => [createWorkflowGenerateImageTool(), createWorkflowResumeImageTool(), createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool(), ...createCharacterTools()]
// 组装依赖 Web Store 的导演与项目工具。
export const createWebTools = ({ projects, directors }) => [...createDirectorTools(directors), ...createProjectTools(projects)]
// 组装插件启动时注册的完整运行时工具清单。
export const createRuntimeTools = ctx => [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools()].map(withWorkcardOutput)

// 创建通用工具组加载入口，只返回当前 Agent 已有权限使用的工具名称。
function createToolDiscoveryTool(ctx) {
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
