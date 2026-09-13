import { MODEL_TIMEOUTS } from '../jobs/contracts.js'
import { completedModelTool } from '../functions/common/tool.js'
import { runMediaJob } from './media-jobs.js'

export function createWorkflowGenerateImageTool() {
  return completedModelTool({
    name: 'workflow_generate_image',
    description: '根据文本生成单张图片，包括人物肖像、场景图或镜头首帧，通过 ComfyUI 工作流生成并等待完成，返回服务器图片 URL。可选参考图提供人物外观条件，一致性需人工验收。普通人物图片使用本工具；完成后等待用户后续指令，不自行追加角色视图或视频。',
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
