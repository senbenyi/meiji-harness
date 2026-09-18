import { createWorkflowGenerateImageTool, createWorkflowResumeImageTool } from './media/image.js'
import { createCharacterTools } from './media/character.js'
// 职责：组装并导出插件对 Harness 暴露的工具定义。
export { createDirectorTools } from './project/director.js'
import { createModelJobResultTool, createModelJobStatusTool } from './task/model.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './media/video.js'
import { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool } from './task/comfyui.js'

export { createProjectTools } from './project/project.js'

export { createModelJobResultTool, createModelJobStatusTool }
export { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool }
export { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool }

export const createModelTools = () => [createModelJobStatusTool(), createModelJobResultTool()]
export const createWorkflowTools = () => [createWorkflowGenerateImageTool(), createWorkflowResumeImageTool(), createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool(), ...createCharacterTools()]
export const createComfyuiTools = () => [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(),
  createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
