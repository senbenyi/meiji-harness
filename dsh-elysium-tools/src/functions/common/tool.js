import { withToolContext } from './task.js'

export const renderToolDebug = (args, value) => {
  if (args.detail === true) return [{ type: 'text', text: JSON.stringify(value) }]
  if (value.status === 'succeeded' && value.result) value = { ...value, ...value.result }
  const keys = ['job_id', 'status', 'stage', 'path', 'size_bytes', 'sha256', 'media_info', 'validation',
    'warnings', 'error_code', 'error', 'failed_stage', 'retryable', 'retry_scope']
  const output = Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
  if (value.comfyui_metadata_status === 'published-final') {
    output.comfyui_view_url = value.comfyui_view_url
    delete output.path
  }
  if (value.workflow && typeof value.workflow === 'object') output.progress = { stage: value.workflow.stage, status: value.workflow.status }
  if (value.debug && value.status !== 'succeeded') {
    output.diagnostic_path = value.debug.diagnostic_path
    output.log_path = value.debug.log_path
    if (value.debug.node_errors?.length) output.node_errors = value.debug.node_errors
  }
  return [{ type: 'text', text: JSON.stringify(output) }]
}

export const COMPLETED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    job_id: { type: 'string' },
    status: { type: 'string' },
    path: { type: 'string' },
    size_bytes: { type: 'number' },
    sha256: { type: 'string' },
    comfyui_prompt_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    comfyui_artifact_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    comfyui_view_url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    comfyui_metadata_status: { type: 'string' },
    comfyui_artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    debug: { type: 'object', additionalProperties: true },
    trace_id: { type: 'string' },
    parent_job_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    stage: { type: 'string' },
    timings: { type: 'object', additionalProperties: true },
    code_version: { type: 'object', additionalProperties: true },
    media_info: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    validation: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['job_id', 'status', 'path', 'size_bytes', 'sha256'],
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
      render: renderToolDebug,
    },
    execute: (args, exec) => withToolContext(name, args, () => execute(args, exec?.signal)),
  }
}
