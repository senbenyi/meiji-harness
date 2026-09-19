// 职责：规范化并校验 AutoDL 的 RealVisXL 图片生成和角色三视图计划。
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { ModelTaskError } from '../../../../../tasks/jobs/errors.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export function isImagePlan(plan) {
  return ['image-generate', 'image-compose'].includes(plan?.capability)
    || (!plan?.mode && !plan?.shots && typeof plan?.prompt === 'string')
}

export function normalizeImagePlan(plan) {
  if (plan?.capability) return structuredClone(plan)
  const images = plan?.images || (plan?.image_path ? [plan.image_path] : [])
  if (!Array.isArray(images) || images.length > 1) throw invalid('AutoDL 图片工作流最多接受一张参考图')
  return { capability: 'image-generate', params: {
    prompt: plan?.prompt,
    seed: plan?.seed ?? 666,
    ...(images[0] ? { image_path: images[0] } : {}),
  } }
}

export function validateImagePlan(input) {
  const { capability, params } = normalizeImagePlan(input)
  if (input.quality !== undefined && !['fast', 'regular', 'high'].includes(input.quality)) throw invalid('图片创作质量无效')
  if (!['image-generate', 'image-compose'].includes(capability) || !params || typeof params !== 'object') throw invalid('未支持的图片任务')
  if (capability === 'image-generate') {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw invalid('prompt 不能为空')
    if (params.preset !== undefined && params.preset !== 'standard') throw invalid('图片质量由系统设置控制')
    if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 2 ** 32 - 1) throw invalid('seed 必须为 uint32')
    if (params.character && !['front', 'side', 'back'].includes(params.character.view)) throw invalid('角色视角无效')
  } else {
    if (!Array.isArray(params.views) || params.views.length !== 3) throw invalid('三视图需要三张图片')
    for (const view of params.views) {
      const crop = view?.crop
      if (!crop || Object.keys(crop).some(key => !['x', 'y', 'width', 'height'].includes(key))
        || ['x', 'y', 'width', 'height'].some(key => !Number.isInteger(crop[key]) || crop[key] < (['x', 'y'].includes(key) ? 0 : 1))) {
        throw invalid('人物边界必须为有效的像素坐标和尺寸')
      }
    }
  }
  const paths = capability === 'image-generate'
    ? (params.image_path === undefined ? [] : [params.image_path])
    : params.views.map(view => view.path)
  for (const path of paths) {
    try { mediaReference(path, ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(error.message) }
  }
  return { capability, params }
}
