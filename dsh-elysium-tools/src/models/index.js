import { createModelAddVideoAudioTool } from './model-add-video-audio.js'
import { createModelGenerateImageTool } from './model-generate-image.js'
import { createModelGenerateLongVideoTool } from './model-generate-long-video.js'
import { createModelInterpolateVideoTool } from './model-interpolate-video.js'
import { createModelJobResultTool } from './model-job-result.js'
import { createModelJobStatusTool } from './model-job-status.js'
import { createModelUpscaleVideoTool } from './model-upscale-video.js'

export {
  createModelAddVideoAudioTool,
  createModelGenerateImageTool,
  createModelGenerateLongVideoTool,
  createModelInterpolateVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
  createModelUpscaleVideoTool,
}
export { ModelTaskError, completedResult, getJob, runModelTask, runWorkflowTask } from './model-task.js'

export function createModelTools() {
  return [
    createModelGenerateImageTool(),
    createModelGenerateLongVideoTool(),
    createModelInterpolateVideoTool(),
    createModelUpscaleVideoTool(),
    createModelAddVideoAudioTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
