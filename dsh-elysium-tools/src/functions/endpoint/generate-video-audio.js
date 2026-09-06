import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoAudioTool() {
  return completedModelTool({
    name: 'model_generate_video_audio',
    description: '按需生成或替换环境音；已有满意音轨时不要调用。当前输出 25fps，需要补帧时先执行本工具。',
    timeoutMs: MODEL_TIMEOUTS.postprocess,
    parameters: {
      properties: {
        video_path: { type: 'string', description: '共享 artifacts 目录下的视频绝对路径。' },
        prompt: { type: 'string', description: '可选的环境音与拟音描述。' },
        steps: { type: 'number', description: '生成步数，默认 25。' },
        seed: { type: 'number', description: '随机种子，默认 42。' },
      },
      required: ['video_path'],
    },
    execute: (args, signal) => runModelTask('video-audio', {
        video_path: args.video_path,
        prompt: args.prompt,
        steps: args.steps ?? 25,
        seed: args.seed ?? 42,
      }, signal, MODEL_TIMEOUTS.postprocess),
  })
}
