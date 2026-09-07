import { createModelGenerateVideoAudioTool } from './endpoint/generate-video-audio.js'
import { createModelGenerateImageTool } from './endpoint/generate-image.js'
import { createModelGenerateVideoLongTool } from './endpoint/generate-video-long.js'
import { createModelGenerateVideoTool } from './endpoint/generate-video.js'
import { createModelConcatVideoTool } from './endpoint/concat-video.js'
import { createModelGenerateDialogueTool } from './endpoint/generate-dialogue.js'
import { createModelInterpolateVideoTool } from './endpoint/interpolate-video.js'
import { createModelJobResultTool } from './jobs/job-result.js'
import { createModelJobStatusTool } from './jobs/job-status.js'
import { createModelUpscaleVideoTool } from './endpoint/upscale-video.js'

export {
  createModelGenerateVideoAudioTool,
  createModelGenerateImageTool,
  createModelGenerateVideoLongTool,
  createModelGenerateVideoTool,
  createModelConcatVideoTool,
  createModelGenerateDialogueTool,
  createModelInterpolateVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
  createModelUpscaleVideoTool,
}
export { ModelTaskError, completedResult, getJob, runModelTask, runWorkflowTask } from './common/task.js'

export function createModelTools() {
  return [
    createModelGenerateImageTool(),
    createModelGenerateVideoLongTool(),
    createModelGenerateVideoTool(),
    createModelConcatVideoTool(),
    createModelGenerateDialogueTool(),
    createModelInterpolateVideoTool(),
    createModelUpscaleVideoTool(),
    createModelGenerateVideoAudioTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
