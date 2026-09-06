import { MODEL_TIMEOUTS, runWorkflowTask } from '../models/model-task.js'
import { completedModelTool } from '../models/model-tool.js'

export function createWorkflowAdultShortVideoTool() {
  return completedModelTool({
    name: 'workflow_adult_short_video',
    description: '执行唯一成人短视频生产链：首帧、一致性、SVI 长视频、插帧、超分、环境音和可选对白。',
    timeoutMs: MODEL_TIMEOUTS.workflow,
    parameters: {
      properties: {
        image_prompt: { type: 'string', description: '成年人物首帧提示词。' },
        video_prompts: { type: 'array', items: { type: 'string' }, description: '1..6 段连续视频提示词。' },
        reference_path: { type: 'string', description: '可选：共享 artifacts 中的虚拟或已授权成年人物参考图。' },
        audio_prompt: { type: 'string', description: '可选：环境音与拟音描述。' },
        dialogue: { type: 'string', description: '可选：FishAudio 对白文本。' },
        preset: { type: 'string', enum: ['fast', 'standard'], description: '生产档位，默认 fast。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
        authorized_adults: { type: 'boolean', description: '必须为 true，确认素材仅包含虚拟或已明确授权成年人。' },
      },
      required: ['image_prompt', 'video_prompts', 'authorized_adults'],
    },
    execute: (args, signal) => runWorkflowTask({
      image_prompt: args.image_prompt,
      video_prompts: args.video_prompts,
      reference_path: args.reference_path,
      audio_prompt: args.audio_prompt,
      dialogue: args.dialogue,
      preset: args.preset || 'fast',
      seed: args.seed ?? 666,
      authorized_adults: args.authorized_adults,
    }, signal, MODEL_TIMEOUTS.workflow),
  })
}
