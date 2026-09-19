// 职责：图片生成、参考图编辑与原任务恢复的 Harness 工具定义；执行交给 worker 任务管理器。
import { retryTask, submitTask, waitJob } from '../../worker/index.js'
import { mediaInvocation, userRequestedRetry } from '../../session/index.js'
import { generationProjectId } from '../project/context.js'
export function createCallToolsImage() {
  return { name: 'call_tools_image', description: '生成图片或使用 images 编辑/组合参考图。优先自有模型，未连接时使用已启用的三方图片渠道。图片可作为角色、场景锚点，结果等待人工验收。失败时保留原任务，不自动重发。', timeoutMs: 121 * 60 * 1000,
    parameters: { type: 'object', additionalProperties: false, required: ['prompt'], properties: {
      project_id: { type: 'string', description: '仅导演模式使用的项目 ID；自由模式省略。' }, prompt: { type: 'string' }, images: { type: 'array', items: { type: 'string' }, description: '参考图片格式由当前渠道能力说明决定。' },
      image_path: { type: 'string', description: '兼容 main 分支的单张 ComfyUI 参考图片地址。' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
      new_image: { type: 'boolean', description: '仅当用户明确要求另一张图片时设为true，失败禁止设为true。' } } },
    async execute({ project_id, new_image = false, ...plan }, exec) {
      const job = await submitTask('image', { ...plan, project_id: await generationProjectId(project_id, exec), new_task: new_image }, mediaInvocation(exec))
      return waitJob(job, exec?.signal)
    } }
}
export function createCallToolsImageRecover() {
  return { name: 'call_tools_image_recover', description: '仅在用户要求重试时调用一次；恢复原图片任务，复用已保存的原请求和提交记录；提交结果未知时拒绝重发，避免重复计费。', timeoutMs: 121 * 60 * 1000,
    parameters: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: { type: 'string' } } },
    async execute(args, exec) {
      const consent = userRequestedRetry(exec?.agent?.session?.snapshotEvents?.())
      return waitJob(await retryTask(args.job_id, { kind: 'image', invocation: mediaInvocation(exec), consent }), exec?.signal)
    } }
}
