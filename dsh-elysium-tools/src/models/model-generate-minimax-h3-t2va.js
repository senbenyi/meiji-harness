import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateMiniMaxH3T2VATool() {
  return completedModelTool({
    name: 'model_generate_minimax_h3_t2va',
    description: 'MiniMax H3 文生音视频：根据画面与声音提示词生成带音轨的视频。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '画面、动作和声音描述。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    execute: (args, signal) => runModelTask('video-generate-minimax-h3', {
      mode: 't2va',
      prompt: String(args.prompt || '').trim(),
      seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
