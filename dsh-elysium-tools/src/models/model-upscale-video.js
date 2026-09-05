import { MODEL_TIMEOUTS, submitAndWait, submitForm } from './model-api.js'
import { completedModelTool } from './model-tool.js'

export function createModelUpscaleVideoTool() {
  return completedModelTool({
    name: 'model_upscale_video',
    description: '对视频超分，等待任务完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.postprocess,
    parameters: {
      properties: {
        video_path: { type: 'string', description: '共享 artifacts 目录下的视频绝对路径。' },
        resolution: { type: 'number', description: '目标短边分辨率，默认 720。' },
        max_resolution: { type: 'number', description: '最大长边分辨率，默认 1280。' },
        batch_size: { type: 'number', description: '批大小，必须是 4n+1，默认 5。' },
      },
      required: ['video_path'],
    },
    execute: (args, signal) => submitAndWait(
      () => submitForm('/videos/upscales', {
        video_path: args.video_path,
        resolution: args.resolution ?? 720,
        max_resolution: args.max_resolution ?? 1280,
        batch_size: args.batch_size ?? 5,
      }, signal),
      signal,
      MODEL_TIMEOUTS.postprocess,
    ),
  })
}

