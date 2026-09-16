// 职责：定义工具返回值的精简渲染与完成任务 schema。
export const renderToolDebug = (args, value) => {
  if (args.detail === true) return [{ type: 'text', text: JSON.stringify(value) }]
  if (value.status === 'succeeded' && value.result) value = { ...value, ...value.result }
  const keys = ['project_id', 'job_id', 'status', 'stage', 'validation',
    'media_kind', 'warnings', 'error_code', 'error', 'failed_stage', 'retryable', 'retry_scope', 'recovery_instruction']
  const output = Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
  if (value.server) {
    const mode = args.mode || value.debug?.effective_input?.mode
    const model = value.model || (mode === 'i2va' ? value.server.connection?.image_model : value.server.connection?.text_model) || value.server.connection?.model
    output.server = { server_id: value.server.server_id, provider: value.server.provider, ...(model ? { model } : {}) }
  }
  if (['published-final', 'comfyui-final'].includes(value.comfyui_metadata_status)) {
    output.comfyui_view_url = value.comfyui_view_url
  }
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
    media_kind: { type: 'string' },
    job_id: { type: 'string' },
    status: { type: 'string' },
    comfyui_prompt_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    comfyui_artifact_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    comfyui_view_url: { type: 'string' },
    comfyui_metadata_status: { type: 'string' },
    comfyui_artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    debug: { type: 'object', additionalProperties: true },
    server: { type: 'object', additionalProperties: true },
    trace_id: { type: 'string' },
    parent_job_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    stage: { type: 'string' },
    timings: { type: 'object', additionalProperties: true },
    code_version: { type: 'object', additionalProperties: true },
    validation: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['job_id', 'status', 'comfyui_view_url'],
}
