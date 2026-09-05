import { createWorkflowImageToFinalVideoTool } from './workflow-image-to-final-video.js'

export { createWorkflowImageToFinalVideoTool }

export function createWorkflowTools() {
  return [createWorkflowImageToFinalVideoTool()]
}
