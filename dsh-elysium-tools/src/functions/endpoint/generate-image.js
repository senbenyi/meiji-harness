import { MODEL_TIMEOUTS } from '../../jobs/contracts.js'
import { runMediaJob } from '../../workflows/media-jobs.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateImageTool() {
  return completedModelTool({
    name: 'model_generate_image',
    description: '根据文本生成角色设定图、场景图或短剧镜头首帧，等待完成后返回真实图片路径，可交给视频工具继续生成。可选参考图保持人物外观，通过 ComfyUI 可视化工作流生成。',
    timeoutMs: MODEL_TIMEOUTS.image,
    parameters: {
      properties: {
        prompt: { type: 'string', description: '要生成的画面描述。' },
        preset: { type: 'string', enum: ['standard'], description: '仅支持 standard。' },
        image_path: { type: 'string', description: '可选，已配置 ComfyUI HTTP view 人物参考图地址。' },
        seed: { type: 'integer', minimum: 0, description: '随机种子，默认 666。' },
      },
      required: ['prompt'],
    },
    execute: (args, signal, exec) => runMediaJob('image-generate', {
        prompt: args.prompt,
        preset: args.preset ?? 'standard',
        ...(args.image_path !== undefined ? { image_path: args.image_path } : {}),
        seed: args.seed ?? 666,
      }, exec),
  })
}
