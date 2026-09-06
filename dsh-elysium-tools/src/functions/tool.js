import { withToolContext } from './task.js'

export const renderToolDebug = (args, value) => {
  const output = value.debug ? { ...value, debug: { ...value.debug,
    chain: value.debug.chain?.map(({ stage, span_id, timestamp, capability, provider, prompt_id, executor }) =>
      ({ stage, span_id, timestamp, capability, provider, prompt_id, executor })),
  } } : value
  return [{ type: 'text', text: JSON.stringify({ input: args, output }, null, 2) }]
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
