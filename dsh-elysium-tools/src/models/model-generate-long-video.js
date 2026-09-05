import { MODEL_TIMEOUTS, submitAndWait, submitForm } from './model-api.js'
import { completedModelTool } from './model-tool.js'

export function createModelGenerateLongVideoTool() {
  return completedModelTool({
    name: 'model_generate_long_video',
    description: '根据角色图片和上一段视频续生成长视频，等待完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.longVideo,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的角色图片绝对路径。' },
        previous_video_path: { type: 'string', description: '共享 artifacts 目录下的上一段视频绝对路径。' },
      },
      required: ['image_path', 'previous_video_path'],
    },
    execute: (args, signal) => submitAndWait(
      () => submitForm('/videos/long-generations', {
        image_path: args.image_path,
        previous_video_path: args.previous_video_path,
      }, signal),
      signal,
      MODEL_TIMEOUTS.longVideo,
    ),
  })
}

