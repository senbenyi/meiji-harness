// 职责：定义视频模式、档位与请求参数校验规则。
import { mediaReference } from '../../comfyui/media-reference.js'
import { ModelTaskError } from '../jobs/errors.js'

export const VIDEO_MODES = Object.freeze(['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'])
export const VIDEO_PROFILES = Object.freeze(['preview', 'regular', 'high-quality', 'standard'])
export const MODE_MEDIA = Object.freeze({
  t2va: [],
  i2va: ['first_frame'],
  fl2va: ['first_frame', 'last_frame'],
  'fl2va-loop': ['first_frame', 'last_frame'],
  r2va: ['reference_image_1', 'reference_image_2'],
})

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export async function validateVideoPlan(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid('参数必须为对象')
  if (!VIDEO_MODES.includes(args.mode)) throw invalid(`mode 仅支持：${VIDEO_MODES.join('、')}`)
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw invalid('prompt 必须为非空字符串')
  const required = MODE_MEDIA[args.mode]
  if (args.profile !== undefined && !VIDEO_PROFILES.includes(args.profile)) throw invalid(`profile 仅支持 ${VIDEO_PROFILES.join('、')}`)
  if (['preview', 'regular'].includes(args.profile) && !['t2va', 'i2va'].includes(args.mode)) throw invalid(`${args.profile} 仅支持 t2va、i2va`)
  if (args.preview_variant !== undefined && (args.profile !== 'preview' || !['default', 'low-resolution'].includes(args.preview_variant))) throw invalid('preview_variant 仅用于 preview，支持 default、low-resolution')
  if (args.duration_seconds !== undefined && (args.profile !== 'regular' || !Number.isFinite(args.duration_seconds) || args.duration_seconds <= 0)) throw invalid('duration_seconds 仅用于 regular，必须为大于 0 的有限数值；生成帧数范围由 H3 节点校验')
  const allowed = new Set(['mode', 'prompt', 'profile', 'preview_variant', 'duration_seconds', ...required])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid(`${args.mode} 包含未支持参数`)
  for (const name of required) {
    if (!(name in args)) throw invalid(`${args.mode} 缺少 ${name}`)
    try { mediaReference(args[name], ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(`${name}: ${error.message}`) }
  }
}
