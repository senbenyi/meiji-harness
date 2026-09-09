import { realpath, stat } from 'node:fs/promises'
import { extname, relative, isAbsolute } from 'node:path'
import { requiredConfig } from '../config.js'
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
  const root = await realpath(requiredConfig('ARTIFACTS_ROOT'))
  for (const path of paths) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw invalid('素材必须为绝对路径')
    const resolved = await realpath(path).catch(() => { throw invalid('素材不存在') })
    const rel = relative(root, resolved), extensions = capability !== 'video-concat' ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.mp4']
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !extensions.includes(extname(resolved).toLowerCase()) || !(await stat(resolved)).isFile()) throw invalid('素材必须为 artifacts 内支持格式的文件')
  }
}
