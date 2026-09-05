import { createModelApiService, IMAGE_TIMEOUT_MS } from '../models/model-api.js'

export function createModelGenerateImageTool(service = createModelApiService()) {
  return {
    name: 'model_generate_image',
    description: '根据文本提示词生成一张图片。工具会等待 GPU 任务完成并返回服务器结果路径。',
    timeoutMs: IMAGE_TIMEOUT_MS + 60_000,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string', description: '要生成的画面描述。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '生成档位，默认 standard。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job_id: { type: 'string' },
          status: { type: 'string' },
          path: { type: 'string' },
          size_bytes: { type: 'number' },
          sha256: { type: 'string' },
        },
        required: ['job_id', 'status', 'path', 'size_bytes', 'sha256'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `图片生成完成：${value.path}\njob_id: ${value.job_id}\nsha256: ${value.sha256}`,
      }],
    },
    execute: (args, exec) => service.generateImage(args, exec?.signal),
  }
}

