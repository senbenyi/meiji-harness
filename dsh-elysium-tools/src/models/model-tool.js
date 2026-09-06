import { withToolContext } from './model-task.js'

export const renderToolDebug = (args, value) => [{
  type: 'text', text: JSON.stringify({ input: args, output: value }, null, 2),
}]

export const COMPLETED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    job_id: { type: 'string' },
    status: { type: 'string' },
    path: { type: 'string' },
    size_bytes: { type: 'number' },
    sha256: { type: 'string' },
    comfyui_prompt_id: { type: ['string', 'null'] },
    comfyui_artifact_id: { type: ['string', 'null'] },
    comfyui_view_url: { type: ['string', 'null'] },
    comfyui_metadata_status: { type: 'string' },
    comfyui_artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    debug: { type: 'object', additionalProperties: true },
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
