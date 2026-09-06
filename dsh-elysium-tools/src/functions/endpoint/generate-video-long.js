import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoLongTool() {
  return completedModelTool({
    name: 'model_generate_video_long',
    description: '根据角色图片和 1..6 段提示词生成连续长视频，执行模型由路由配置决定。',
    timeoutMs: MODEL_TIMEOUTS.longVideo,
    parameters: {
      properties: {
        image_path: { type: 'string', description: '共享 artifacts 目录下的角色图片绝对路径。' },
        prompts: { type: 'array', items: { type: 'string' }, description: '按顺序排列的 1..6 段视频提示词。' },
        preset: { type: 'string', enum: ['long_mvp_preview', 'long_mvp_final'], description: '长视频档位，默认 long_mvp_preview。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['image_path', 'prompts'],
    },
    execute: (args, signal) => runModelTask('video-generate-long', {
        image_path: args.image_path,
        prompts: args.prompts,
        preset: args.preset || 'long_mvp_preview',
        seed: args.seed ?? 666,
      }, signal, MODEL_TIMEOUTS.longVideo),
  })
}
