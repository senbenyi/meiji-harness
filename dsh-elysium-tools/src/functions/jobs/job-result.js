import { completedResult, getJob } from '../common/task.js'
import { COMPLETED_RESULT_SCHEMA, renderToolDebug } from '../common/tool.js'

export function createModelJobResultTool() {
  return {
    name: 'model_job_result',
    description: '取得已成功模型任务的产物路径、大小与哈希。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' } },
      required: ['job_id'],
    },
    output: {
      schema: COMPLETED_RESULT_SCHEMA,
      render: renderToolDebug,
    },
    execute: async (args, exec) => completedResult(await getJob(args.job_id, exec?.signal)),
  }
}
