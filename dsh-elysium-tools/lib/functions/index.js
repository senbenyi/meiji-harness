import { createModelJobResultTool } from './jobs/job-result.js'
import { createModelJobStatusTool } from './jobs/job-status.js'

export {
  createModelJobResultTool,
  createModelJobStatusTool,
}
export { ModelTaskError, completedResult, getJob } from './common/task.js'

export function createModelTools() {
  return [
    createModelJobStatusTool(),
    createModelJobResultTool(),
  ]
}
