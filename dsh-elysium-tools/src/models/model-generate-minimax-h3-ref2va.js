import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateMiniMaxH3REF2VATool() {
  return completedModelTool({
    name: 'model_generate_minimax_h3_ref2va',
    description: 'MiniMax H3 REF2VA（参考图片、视频或音频生成音视频，至少提供一项参考素材）。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '画面、动作和声音描述。' },
        image_path: { type: 'string', description: '参考图绝对路径。' },
        video_path: { type: 'string', description: '参考视频绝对路径。' },
        audio_path: { type: 'string', description: '参考音频绝对路径。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    execute: (args, signal) => runModelTask('video-generate-minimax-h3', {
      mode: 'ref2va',
      prompt: String(args.prompt || '').trim(),
      image_path: args.image_path,
      video_path: args.video_path,
      audio_path: args.audio_path,
      seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
