import { mediaReference } from '../media/http-media.js'
import { ModelTaskError } from '../jobs/contracts.js'

export const VIDEO_MODES = Object.freeze(['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'])
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
  const allowed = new Set(['mode', 'prompt', ...required])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid(`${args.mode} 包含未支持参数`)
  for (const name of required) {
    if (!(name in args)) throw invalid(`${args.mode} 缺少 ${name}`)
    try { mediaReference(args[name], ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(`${name}: ${error.message}`) }
  }
}
