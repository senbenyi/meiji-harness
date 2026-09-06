import { createModelGenerateVideoAudioTool } from './generate-video-audio.js'
import { createModelGenerateImageTool } from './generate-image.js'
import { createModelGenerateVideoLongTool } from './generate-video-long.js'
import { createModelGenerateVideoTool } from './generate-video.js'
import { createModelGenerateDialogueTool } from './generate-dialogue.js'
import { createModelInterpolateVideoTool } from './interpolate-video.js'
import { createModelJobResultTool } from './job-result.js'
import { createModelJobStatusTool } from './job-status.js'
import { createModelUpscaleVideoTool } from './upscale-video.js'

export {
  createModelGenerateVideoAudioTool,
  createModelGenerateImageTool,
  createModelGenerateVideoLongTool,
  createModelGenerateVideoTool,
  createModelGenerateDialogueTool,
  createModelInterpolateVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
  createModelUpscaleVideoTool,
}
export { ModelTaskError, completedResult, getJob, runModelTask, runWorkflowTask } from './task.js'

export function createModelTools() {
  return [
    createModelGenerateImageTool(),
    createModelGenerateVideoLongTool(),
    createModelGenerateVideoTool(),
    createModelGenerateDialogueTool(),
    createModelInterpolateVideoTool(),
    createModelUpscaleVideoTool(),
    createModelGenerateVideoAudioTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
