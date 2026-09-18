// 职责：统一导出并组装工具、Agent 投影和创作提示，对插件入口隐藏具体工具清单。
import { createCharacterTools } from './media/character.js'
import { createDirectorTools } from './project/director.js'
import { createProjectTools } from './project/project.js'
import { createModelJobResultTool, createModelJobStatusTool } from './task/model.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './media/video.js'
import { createWorkflowGenerateImageTool, createWorkflowResumeImageTool } from './media/image.js'
import { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool } from './task/comfyui.js'
import { createToolDiscoveryTool } from './core/discovery.js'
import { isElysiumAgent, projectAssemblyForAgent } from './agent/index.js'
import { creationInstructions } from './prompts/creation.js'

// 工具基础能力、Agent 投影与创作提示。
export { createToolDiscoveryTool, isElysiumAgent, projectAssemblyForAgent, creationInstructions }

// 可独立复用的任务工具工厂。
export { createDirectorTools, createProjectTools }
export { createModelJobResultTool, createModelJobStatusTool }
export { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool }
export { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool }

// 组装与模型任务状态和结果查询相关的工具。
export const createModelTools = () => [createModelJobStatusTool(), createModelJobResultTool()]
// 组装面向用户的图片、视频与角色工作流工具。
export const createWorkflowTools = () => [createWorkflowGenerateImageTool(), createWorkflowResumeImageTool(), createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool(), ...createCharacterTools()]
// 原子工具关闭时返回空集合；开启时组装直接操作 ComfyUI 队列、状态、结果和取消能力的工具。
export const createComfyuiTools = runtime => runtime.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1'
  ? [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(), createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
  : []
// 组装依赖 Web Store 的导演与项目工具。
export const createWebTools = ({ projects, directors }) => [...createDirectorTools(directors), ...createProjectTools(projects)]
// 组装插件启动时注册的完整运行时工具清单。
export const createRuntimeTools = (ctx, runtime) => [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools(), ...createComfyuiTools(runtime)]
