import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoLongTool() {
  return completedModelTool({
    name: 'model_generate_video_long',
    description: '生成总时长超过 15 秒的连续长视频；起始图片加分段提示词，模型由路由决定。建议每段约 5 秒，保留原生帧率和音轨；不超过 15 秒使用 model_generate_video。',
    timeoutMs: MODEL_TIMEOUTS.longVideo,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的角色图片绝对路径。' },
        prompts: { type: 'array', minItems: 2, items: { type: 'string' }, description: '至少 2 段连续提示词，一条对应一段；建议按每段约 5 秒规划。' },
        duration: { type: 'integer', minimum: 16, description: '总秒数，默认 max(20, 段数×5)；均分至各段，每段最多 15 秒。总时长受段数、服务器单段限制和任务超时约束。' },
        preset: { type: 'string', enum: ['long_fast', 'long_standard', 'long_vertical_standard', 'long_vertical_preview'], description: '画幅预设，默认 long_vertical_preview；采样参数由服务器配置管理。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['image_path', 'prompts'],
    },
    execute: (args, signal) => runModelTask('video-generate-long', {
        image_path: args.image_path,
        prompts: args.prompts,
        duration: args.duration ?? Math.max(20, (args.prompts?.length || 0) * 5),
        preset: args.preset || 'long_vertical_preview',
        seed: args.seed ?? 666,
      }, signal, MODEL_TIMEOUTS.longVideo),
  })
}
