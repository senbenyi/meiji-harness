// 职责：在公共协议校验上叠加本平台视频档位约束。
import { validatePlan as validateProtocolPlan } from '../../protocols/comfyui/plan.js'
import { ModelTaskError } from '../../../server/jobs/errors.js'
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
export async function validatePlan(args) {
  if (!args || typeof args !== 'object') return validateProtocolPlan(args)
  if (['preview', 'regular'].includes(args.profile) && !['t2va', 'i2va'].includes(args.mode)) throw invalid(`${args.profile} 仅支持 t2va、i2va`)
  if (args.preview_variant !== undefined && (args.profile !== 'preview' || !['default', 'low-resolution'].includes(args.preview_variant))) throw invalid('preview_variant 仅用于 preview，支持 default、low-resolution')
  if (args.duration_seconds !== undefined && (args.profile !== 'regular' || !Number.isFinite(args.duration_seconds) || args.duration_seconds <= 0)) throw invalid('duration_seconds 仅用于 regular，必须为大于 0 的有限数值；生成帧数范围由 H3 节点校验')
  validateProtocolPlan(args)
}
