import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateMiniMaxH3FL2VATool() {
  return completedModelTool({
    name: 'model_generate_minimax_h3_fl2va',
    description: 'MiniMax H3 FL2VA（图片生成带声音的视频）。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '画面、动作和声音描述。' },
        image_path: { type: 'string', description: '起始参考图绝对路径，必须位于共享 artifacts 目录。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt', 'image_path'],
    },
    execute: (args, signal) => runModelTask('video-generate-minimax-h3', {
      mode: 'fl2va',
      prompt: String(args.prompt || '').trim(),
      image_path: args.image_path,
      seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
