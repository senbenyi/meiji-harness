// 职责：定义本地模型任务的状态与结果查询工具。
import { completedResult, getJob } from '../../server/jobs/query.js'

export function createCallToolsJobStatus() {
  return {
    name: 'call_tools_job_status',
    description: '查询模型任务状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' }, detail: { type: 'boolean', description: '仅排错时返回完整诊断，默认 false。' } },
      required: ['job_id'],
    },
    execute: (args) => getJob(args.job_id),
  }
}

export function createCallToolsJobResult() {
  return {
    name: 'call_tools_job_result',
    description: '取得已成功模型任务的服务器媒体 URL 与结果元数据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { job_id: { type: 'string', description: '32 位任务 ID。' }, detail: { type: 'boolean', description: '仅排错时返回完整诊断，默认 false。' } },
      required: ['job_id'],
    },
    execute: async (args) => completedResult(await getJob(args.job_id)),
  }
}
