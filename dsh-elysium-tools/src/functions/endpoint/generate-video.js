import { MODEL_TIMEOUTS, ModelTaskError } from '../../jobs/contracts.js'
import { startVideoJob } from '../../workflows/video-jobs.js'
import { waitJob } from '../../jobs/wait.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoTool() {
  return completedModelTool({
    name: 'model_generate_video',
    description: '生成不超过 15 秒的短视频：文字、起始图片或参考素材生成；超过 15 秒使用 model_generate_video_long。通过 ComfyUI 可视化工作流生成，交付规格取工作流，保留音轨。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        mode: { type: 'string', enum: ['text', 'image', 'reference'], description: 'text：文字生成视频；image：起始图片生成视频；reference：参考图片、视频或音频生成视频。是否带声音由执行模型决定。' },
        prompt: { type: 'string', description: '画面、动作及所需声音描述。' },
        duration: { type: 'integer', minimum: 1, maximum: 15, description: '短视频秒数，默认 5；15 秒仍属于短视频。' },
        image_path: { type: 'string', description: '共享 artifacts 下图片绝对路径；image 模式必填。' },
        video_path: { type: 'string', description: '共享 artifacts 下参考视频绝对路径；仅 reference 模式。' },
        audio_path: { type: 'string', description: '共享 artifacts 下参考音频绝对路径；仅 reference 模式。' },
        seed: { type: 'integer', minimum: 0, description: '随机种子，默认 666。' },
      },
      required: ['mode', 'prompt'],
    },
    execute: async (args, signal, exec) => {
      const media = ['image_path', 'video_path', 'audio_path'].filter(key => args[key] !== undefined)
      if (!['text', 'image', 'reference'].includes(args.mode)
        || (args.mode === 'text' && media.length)
        || (args.mode === 'image' && (media.length !== 1 || media[0] !== 'image_path'))) {
        throw new ModelTaskError('MODEL_INPUT_INVALID', 'mode 与参考素材不匹配', 422)
      }
      const duration = args.duration ?? 5
      const shot = { id: 'shot-1', mode: args.mode === 'reference' ? 'reference' : 'independent',
        prompt: args.prompt, duration, ...Object.fromEntries(media.map(key => [key, args[key]])) }
      const result = await waitJob(await startVideoJob({ duration, shots: [shot], seed: args.seed ?? 666 }, exec), signal)
      if (result.status === 'failed') throw new ModelTaskError(result.error_code || 'MODEL_JOB_FAILED', `任务 ${result.job_id} 失败：${result.error}`, 500)
      return result
    },
  })
}
