import { createModelGenerateImageTool } from './endpoint/generate-image.js'
import { createModelGenerateVideoLongTool } from './endpoint/generate-video-long.js'
import { createModelGenerateVideoTool } from './endpoint/generate-video.js'
import { createModelConcatVideoTool } from './endpoint/concat-video.js'
import { createModelJobResultTool } from './jobs/job-result.js'
import { createModelJobStatusTool } from './jobs/job-status.js'

export {
  createModelGenerateImageTool,
  createModelGenerateVideoLongTool,
  createModelGenerateVideoTool,
  createModelConcatVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
}
export { ModelTaskError, completedResult, getJob } from './common/task.js'

export function createModelTools() {
  return [
    createModelGenerateImageTool(),
    createModelGenerateVideoLongTool(),
    createModelGenerateVideoTool(),
    createModelConcatVideoTool(),
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
