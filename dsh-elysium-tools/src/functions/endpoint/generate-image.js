import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateImageTool() {
  return completedModelTool({
    name: 'model_generate_image',
    description: '根据文本提示词生成图片，等待任务完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.image,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '要生成的画面描述。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '生成档位，默认 standard。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    execute: (args, signal) => runModelTask('image-generate', {
        prompt: String(args.prompt || '').trim(),
        preset: args.preset || 'standard',
        seed: args.seed ?? 666,
      }, signal, MODEL_TIMEOUTS.image),
  })
}
