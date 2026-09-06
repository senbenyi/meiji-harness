import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelUpscaleVideoTool() {
  return completedModelTool({
    name: 'model_upscale_video',
    description: '对视频超分，等待任务完成后返回产物路径。耗时与输入帧数成正比，同时需要插帧时必须先超分再插帧。',
    timeoutMs: MODEL_TIMEOUTS.postprocess,
    parameters: {
      properties: {
        video_path: { type: 'string', description: '共享 artifacts 目录下的视频绝对路径。' },
        resolution: { type: 'number', description: '目标短边分辨率，默认 720。' },
        max_resolution: { type: 'number', description: '最大长边分辨率，默认 1280。' },
        batch_size: { type: 'number', description: '批大小，必须是 4n+1，默认 21。' },
      },
      required: ['video_path'],
    },
    execute: (args, signal) => runModelTask('video-upscale', {
        video_path: args.video_path,
        resolution: args.resolution ?? 720,
        max_resolution: args.max_resolution ?? 1280,
        batch_size: args.batch_size ?? 21,
      }, signal, MODEL_TIMEOUTS.postprocess),
  })
}
