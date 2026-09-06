import { MODEL_TIMEOUTS, runModelTask } from './task.js'
import { completedModelTool } from './tool.js'

export function createModelGenerateVideoAudioTool() {
  return completedModelTool({
    name: 'model_generate_video_audio',
    description: '为视频生成并合成环境音，等待任务完成后返回产物路径。',
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
