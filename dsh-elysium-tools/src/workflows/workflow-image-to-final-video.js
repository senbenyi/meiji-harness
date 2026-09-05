import { MODEL_TIMEOUTS, submitAndWait, submitJson } from '../models/model-api.js'
import { completedModelTool } from '../models/model-tool.js'

export function createWorkflowImageToFinalVideoTool() {
  return completedModelTool({
    name: 'workflow_image_to_final_video',
    description: '从起始图片生成视频，并依次完成插帧、超分和环境音合成。',
    timeoutMs: MODEL_TIMEOUTS.workflow,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的起始图片绝对路径。' },
        video_prompt: { type: 'string', description: '可选的视频动作、镜头和场景描述。' },
        audio_prompt: { type: 'string', description: '可选的环境音与拟音描述。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '视频生成档位，默认 fast。' },
        seed: { type: 'number', description: '视频生成随机种子，默认 666。' },
      },
      required: ['image_path'],
    },
    execute: (args, signal) => submitAndWait(
      () => submitJson('/workflows/image-to-final-video/runs', {
        image_path: args.image_path,
        video_prompt: args.video_prompt,
        audio_prompt: args.audio_prompt,
        preset: args.preset || 'fast',
        seed: args.seed ?? 666,
      }, signal),
      signal,
      MODEL_TIMEOUTS.workflow,
    ),
  })
}
