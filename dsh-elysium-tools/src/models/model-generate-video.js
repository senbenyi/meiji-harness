import { MODEL_TIMEOUTS, submitAndWait, submitForm } from './model-api.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateVideoTool() {
  return completedModelTool({
    name: 'model_generate_video',
    description: '根据起始图片生成视频，等待任务完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的起始图片绝对路径。' },
        prompt: { type: 'string', description: '可选的视频画面描述。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '生成档位，默认 fast。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['image_path'],
    },
    execute: (args, signal) => submitAndWait(
      () => submitForm('/videos/generations', {
        image_path: args.image_path,
        prompt: args.prompt,
        preset: args.preset || 'fast',
        seed: args.seed ?? 666,
      }, signal),
      signal,
      MODEL_TIMEOUTS.video,
    ),
  })
}

