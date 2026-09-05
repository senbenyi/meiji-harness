import { getJob } from './model-api.js'

export function createModelJobStatusTool() {
  return {
    name: 'model_job_status',
    description: '查询 Model API 任务状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' } },
      required: ['job_id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          job_id: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['job_id', 'status'],
      },
      render: (_args, value) => [{ type: 'text', text: `任务 ${value.job_id}：${value.status}` }],
    },
    execute: (args, exec) => getJob(args.job_id, exec?.signal),
  }
}

