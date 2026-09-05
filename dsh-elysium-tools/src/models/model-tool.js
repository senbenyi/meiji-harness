export const COMPLETED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    job_id: { type: 'string' },
    status: { type: 'string' },
    path: { type: 'string' },
    size_bytes: { type: 'number' },
    sha256: { type: 'string' },
    result_url: { type: 'string' },
    receipt_path: { type: 'string' },
    contract_version: { type: 'string' },
  },
  required: ['job_id', 'status', 'path', 'size_bytes', 'sha256', 'result_url'],
}

export function completedModelTool({ name, description, timeoutMs, parameters, execute }) {
  return {
    name,
    description,
    timeoutMs: timeoutMs + 60_000,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: parameters.properties,
      required: parameters.required,
    },
    output: {
      schema: COMPLETED_RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `模型任务完成：${value.path}\njob_id: ${value.job_id}\nsha256: ${value.sha256}`,
      }],
    },
    execute: (args, exec) => execute(args, exec?.signal),
  }
}

