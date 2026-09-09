import { MODEL_TIMEOUTS, ModelTaskError } from '../common/task.js'
import { startVideoJob } from '../../workflows/video-jobs.js'
import { waitVideoJob } from '../../workflows/workflow-generate-video.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoLongTool() {
  return completedModelTool({
    name: 'model_generate_video_long',
    description: '生成总时长超过 15 秒的连续长视频；起始图片加分段提示词，通过 ComfyUI 导演工作流续拍。建议每段约 5 秒，交付规格取工作流并保留音轨；不超过 15 秒使用 model_generate_video。',
    timeoutMs: MODEL_TIMEOUTS.longVideo,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的角色图片绝对路径。' },
        prompts: { type: 'array', minItems: 2, items: { type: 'string' }, description: '至少 2 段连续提示词，一条对应一段；建议按每段约 5 秒规划。' },
        duration: { type: 'integer', minimum: 16, description: '总秒数，默认 max(20, 段数×5)；均分至各段，每段最多 15 秒。总时长受段数、服务器单段限制和任务超时约束。' },
        preset: { type: 'string', enum: ['long_fast', 'long_standard', 'long_vertical_standard', 'long_vertical_preview'], description: '兼容旧预设名称，默认 long_vertical_preview；画幅和采样参数统一取可视化工作流。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['image_path', 'prompts'],
    },
    execute: async (args, signal, exec) => {
      const duration = args.duration ?? Math.max(20, (args.prompts?.length || 0) * 5)
      if (!Number.isInteger(duration) || duration <= 15 || !args.image_path
        || (args.preset !== undefined && !['long_fast', 'long_standard', 'long_vertical_standard', 'long_vertical_preview'].includes(args.preset))) {
        throw new ModelTaskError('MODEL_INPUT_INVALID', '长视频需要首帧、超过 15 秒的整数时长和有效预设', 422)
      }
      const result = await waitVideoJob(await startVideoJob({ duration, prompts: args.prompts,
        image_path: args.image_path, seed: args.seed ?? 666 }, exec), signal)
      if (result.status === 'failed') throw new ModelTaskError(result.error_code || 'MODEL_JOB_FAILED', `任务 ${result.job_id} 失败：${result.error}`, 500)
      return result
    },
  })
}
