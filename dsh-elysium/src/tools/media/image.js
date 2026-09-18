// 职责：将图片生成、参考图编辑与原任务恢复适配为 Harness 工具。
import { resumeImageJob, startImageJob } from '../../server/workflows/images/service.js'
import { generationProjectId } from '../project/context.js'
export function createCallToolsImage() {
  return { name: 'call_tools_image', description: '生成图片或使用 images 编辑/组合参考图。优先自有模型，未连接时使用已启用的三方图片渠道。图片可作为角色、场景锚点，结果等待人工验收。失败时保留原任务，不自动重发。', timeoutMs: 121 * 60 * 1000,
    parameters: { type: 'object', additionalProperties: false, required: ['prompt'], properties: {
      project_id: { type: 'string', description: '仅导演模式使用的项目 ID；自由和教学模式省略。' }, prompt: { type: 'string' }, images: { type: 'array', items: { type: 'string' }, description: '参考图片格式由当前渠道能力说明决定。' },
      preset: { type: 'string', enum: ['standard'], description: '自有图片工作流规格。' },
      image_path: { type: 'string', description: '兼容 main 分支的单张 ComfyUI 参考图片地址。' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
      new_image: { type: 'boolean', description: '仅当用户明确要求另一张图片时设为true，失败禁止设为true。' } } },
    async execute(args, exec) {
      const { project_id, new_image = false, ...plan } = args
      const projectId = await generationProjectId(project_id, exec)
      return startImageJob(projectId, plan, new_image, exec)
    } }
}
export function createCallToolsImageRecover() {
  return { name: 'call_tools_image_recover', description: '恢复原图片任务，仅重新取回已保存的原响应和产物；提交结果未知时拒绝重发，避免重复计费。', timeoutMs: 121 * 60 * 1000,
    parameters: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: { type: 'string' } } },
    async execute(args, exec) {
      return resumeImageJob(args.job_id, exec)
    } }
}
