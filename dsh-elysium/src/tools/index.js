// 职责：集中导出工具工厂，并按运行场景组装模型、工作流和 ComfyUI 工具集合；不注册或执行工具。
import { createCharacterTools } from './media/character.js'
export { createDirectorTools } from './project/director.js'
export { createProjectTools } from './project/project.js'
import { createModelJobResultTool, createModelJobStatusTool } from './task/model.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './media/video.js'
import { createWorkflowGenerateImageTool, createWorkflowResumeImageTool } from './media/image.js'
import { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool } from './task/comfyui.js'

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
