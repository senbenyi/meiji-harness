import { completedResult, getJob } from './model-api.js'
import { COMPLETED_RESULT_SCHEMA } from './model-tool.js'

export function createModelJobResultTool() {
  return {
    name: 'model_job_result',
    description: '取得已成功 Model API 任务的产物路径、大小与哈希。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' } },
      required: ['job_id'],
    },
    output: {
      schema: COMPLETED_RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `任务产物：${value.path}\nsize: ${value.size_bytes}\nsha256: ${value.sha256}`,
      }],
    },
    execute: async (args, exec) => completedResult(await getJob(args.job_id, exec?.signal)),
  }
}

