import { createWorkflowGenerateImageTool, createWorkflowResumeImageTool } from './image.js'
// 职责：组装并导出插件对 Harness 暴露的工具定义。
export { createDirectorTools } from './director.js'
import { createModelJobResultTool, createModelJobStatusTool } from './jobs.js'
import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './video.js'
import { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool } from './tasks.js'

export { createProjectTools } from './project.js'

export { createModelJobResultTool, createModelJobStatusTool }
export { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool }
export { createComfyuiTaskCancelTool, createComfyuiTaskQueueTool, createComfyuiTaskResultTool, createComfyuiTaskStatusTool }

export const createModelTools = () => [createModelJobStatusTool(), createModelJobResultTool()]
export const createWorkflowTools = () => [createWorkflowGenerateImageTool(), createWorkflowResumeImageTool(), createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool()]
export const createComfyuiTools = () => [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(),
  createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
