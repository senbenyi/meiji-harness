// 职责：校验公共视频请求结构及 ComfyUI 素材引用；平台档位限制由提供者叠加。
import { VIDEO_MODES, VIDEO_PROFILES, MODE_MEDIA } from '../../../server/workflows/videos/plan.js'
import { mediaReference } from './media-reference.js'
import { ModelTaskError } from '../../../server/jobs/errors.js'
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export function validatePlan(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid('参数必须为对象')
  if (!VIDEO_MODES.includes(args.mode)) throw invalid(`mode 仅支持：${VIDEO_MODES.join('、')}`)
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw invalid('prompt 必须为非空字符串')
  const required = MODE_MEDIA[args.mode]
  if (args.profile !== undefined && !VIDEO_PROFILES.includes(args.profile)) throw invalid(`profile 仅支持 ${VIDEO_PROFILES.join('、')}`)
  const allowed = new Set(['mode', 'prompt', 'profile', 'preview_variant', 'duration_seconds', ...required])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid(`${args.mode} 包含未支持参数`)
  for (const name of required) {
    if (!(name in args)) throw invalid(`${args.mode} 缺少 ${name}`)
    try { mediaReference(args[name], ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(`${name}: ${error.message}`) }
  }
}
