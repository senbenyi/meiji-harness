import { getJob } from '../../jobs/query.js'
import { renderToolDebug } from '../common/tool.js'

export function createModelJobStatusTool() {
  return {
    name: 'model_job_status',
    description: '查询模型任务状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' }, detail: { type: 'boolean', description: '仅排错时返回完整诊断，默认 false。' } },
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
      render: renderToolDebug,
    },
    execute: (args, exec) => getJob(args.job_id, exec?.signal),
  }
}
