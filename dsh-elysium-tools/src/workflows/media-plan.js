import { mediaReference } from '../media/http-media.js'
import { ModelTaskError } from '../jobs/contracts.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
export async function validateMediaPlan({ capability, params }) {
  if (!['image-generate', 'image-compose', 'video-concat'].includes(capability)) throw invalid('未支持的媒体任务')
  if (capability === 'image-generate') {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw invalid('prompt 不能为空')
    if (params.preset !== undefined && params.preset !== 'standard') throw invalid('图片仅支持 standard')
    if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 2 ** 32 - 1) throw invalid('seed 必须为 uint32')
  } else if (capability === 'image-compose') {
    if (!Array.isArray(params.views) || params.views.length !== 3) throw invalid('三视图需要三张图片')
    for (const { crop } of params.views) {
      if (!crop || Object.keys(crop).some(k => !['x', 'y', 'width', 'height'].includes(k)) ||
          ['x', 'y', 'width', 'height'].some(k => !Number.isInteger(crop[k]) || crop[k] < (['x', 'y'].includes(k) ? 0 : 1))) throw invalid('人物边界必须为有效的像素坐标和尺寸')
    }
  } else if (!Array.isArray(params.video_paths) || params.video_paths.length < 2) throw invalid('至少需要两个视频')
  const paths = capability === 'image-generate' ? (params.image_path === undefined ? [] : [params.image_path]) : capability === 'image-compose' ? params.views.map(v => v.path) : params.video_paths
  for (const path of paths) {
    try { mediaReference(path, capability === 'video-concat' ? ['.mp4'] : ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(error.message) }
  }
}
