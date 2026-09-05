import { createModelAddVideoAudioTool } from './model-add-video-audio.js'
import { createModelEditImageTool } from './model-edit-image.js'
import { createModelGenerateImageTool } from './model-generate-image.js'
import { createModelGenerateLongVideoTool } from './model-generate-long-video.js'
import { createModelGenerateVideoTool } from './model-generate-video.js'
import { createModelInterpolateVideoTool } from './model-interpolate-video.js'
import { createModelJobResultTool } from './model-job-result.js'
import { createModelJobStatusTool } from './model-job-status.js'
import { createModelUpscaleVideoTool } from './model-upscale-video.js'

export {
  createModelAddVideoAudioTool,
  createModelEditImageTool,
  createModelGenerateImageTool,
  createModelGenerateLongVideoTool,
  createModelGenerateVideoTool,
  createModelInterpolateVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
  createModelUpscaleVideoTool,
}
export { ModelApiError, completedResult, getJob, waitForJob } from './model-api.js'

export function createModelTools() {
  return [
    createModelGenerateImageTool(),
    createModelEditImageTool(),
    createModelGenerateVideoTool(),
    createModelGenerateLongVideoTool(),
    createModelInterpolateVideoTool(),
    createModelUpscaleVideoTool(),
    createModelAddVideoAudioTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}

