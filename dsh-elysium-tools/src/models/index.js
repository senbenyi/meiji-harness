import { createModelAddVideoAudioTool } from './model-add-video-audio.js'
import { createModelGenerateImageTool } from './model-generate-image.js'
import { createModelGenerateLongVideoTool } from './model-generate-long-video.js'
import { createModelGenerateMiniMaxH3T2VATool } from './model-generate-minimax-h3-t2va.js'
import { createModelGenerateMiniMaxH3FL2VATool } from './model-generate-minimax-h3-fl2va.js'
import { createModelGenerateMiniMaxH3REF2VATool } from './model-generate-minimax-h3-ref2va.js'
import { createModelInterpolateVideoTool } from './model-interpolate-video.js'
import { createModelJobResultTool } from './model-job-result.js'
import { createModelJobStatusTool } from './model-job-status.js'
import { createModelUpscaleVideoTool } from './model-upscale-video.js'

export {
  createModelAddVideoAudioTool,
  createModelGenerateImageTool,
  createModelGenerateLongVideoTool,
  createModelGenerateMiniMaxH3T2VATool,
  createModelGenerateMiniMaxH3FL2VATool,
  createModelGenerateMiniMaxH3REF2VATool,
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
    createModelGenerateMiniMaxH3T2VATool(),
    createModelGenerateMiniMaxH3FL2VATool(),
    createModelGenerateMiniMaxH3REF2VATool(),
    createModelInterpolateVideoTool(),
    createModelUpscaleVideoTool(),
    createModelAddVideoAudioTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
