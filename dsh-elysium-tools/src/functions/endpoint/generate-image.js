import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateImageTool() {
  return completedModelTool({
    name: 'model_generate_image',
    description: '根据文本生成角色设定图、场景图或短剧镜头首帧，等待完成后返回真实图片路径，可交给视频工具继续生成。此工具不接收参考图。',
    timeoutMs: MODEL_TIMEOUTS.image,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '要生成的画面描述。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '生成档位，默认 fast。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    execute: (args, signal) => runModelTask('image-generate', {
        prompt: String(args.prompt || '').trim(),
        preset: args.preset || 'fast',
        seed: args.seed ?? 666,
      }, signal, MODEL_TIMEOUTS.image),
  })
}
