import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelInterpolateVideoTool() {
  return completedModelTool({
    name: 'model_interpolate_video',
    description: '仅在需要提高帧率时插帧；默认保留生成原片。按所选倍数增加帧数，同时需要配音或超分时排在它们之后。',
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
