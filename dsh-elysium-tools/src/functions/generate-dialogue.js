import { MODEL_TIMEOUTS, runModelTask } from './task.js'
import { completedModelTool } from './tool.js'

export function createModelGenerateDialogueTool() {
  return completedModelTool({
    name: 'model_generate_dialogue',
    description: '将对白文本生成为语音音频，执行模型由路由配置决定。',
    timeoutMs: MODEL_TIMEOUTS.image,
    parameters: {
      properties: {
        text: { type: 'string', description: '需要朗读的对白文本。' },
        language: { type: 'string', description: '语言代码，默认 zh。' },
        seed: { type: 'integer', minimum: 0, description: '随机种子，默认 42。' },
      },
      required: ['text'],
    },
    execute: (args, signal) => runModelTask('dialogue-generate', {
      text: args.text, language: args.language || 'zh', seed: args.seed ?? 42,
    }, signal, MODEL_TIMEOUTS.image),
  })
}
