import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelInterpolateVideoTool() {
  return completedModelTool({
    name: 'model_interpolate_video',
    description: '对视频插帧，等待任务完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.postprocess,
    parameters: {
      properties: {
        video_path: { type: 'string', description: '共享 artifacts 目录下的视频绝对路径。' },
        multiplier: { type: 'number', enum: [2, 3, 4], description: '插帧倍数，默认 2。' },
      },
      required: ['video_path'],
    },
    execute: (args, signal) => runModelTask('video-interpolate', {
        video_path: args.video_path,
        multiplier: args.multiplier ?? 2,
      }, signal, MODEL_TIMEOUTS.postprocess),
  })
}
