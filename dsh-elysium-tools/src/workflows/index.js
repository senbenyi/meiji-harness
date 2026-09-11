import { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool } from './workflow-generate-video.js'

export { createWorkflowGenerateVideoTool, createWorkflowResumeVideoTool }

export function createWorkflowTools() {
  return [createWorkflowGenerateVideoTool(), createWorkflowResumeVideoTool()]
}
