import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateMiniMaxH3VideoTool() {
  return completedModelTool({
    name: 'model_generate_minimax_h3_video',
    description: '使用 DaSiWa MiniMax H3 生成带同步音频的视频，支持 T2VA、FL2VA 和 REF2VA。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        mode: { type: 'string', enum: ['t2va', 'fl2va', 'ref2va'], description: '生成模式。' },
        prompt: { type: 'string', description: '画面、动作和声音描述。' },
        image_path: { type: 'string', description: 'FL2VA 必填；REF2VA 可选的参考图绝对路径。' },
        video_path: { type: 'string', description: 'REF2VA 可选的参考视频绝对路径。' },
        audio_path: { type: 'string', description: 'REF2VA 可选的参考音频绝对路径。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['mode', 'prompt'],
    },
    execute: (args, signal) => runModelTask('video-generate-minimax-h3', {
      mode: args.mode,
      prompt: String(args.prompt || '').trim(),
      image_path: args.image_path,
      video_path: args.video_path,
      audio_path: args.audio_path,
      seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
