import { ModelTaskError } from '../jobs/contracts.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
export async function resolveVideoPlan(args, signal) {
  if (!Object.hasOwn(args, 'plan_path')) return args
  if (Object.keys(args).length !== 1 || typeof args.plan_path !== 'string') throw invalid('plan_path 必须单独使用，不能覆盖分镜文件中的字段')
  let url
  try { url = new URL(args.plan_path) } catch { throw invalid('分镜必须为 HTTP(S) JSON 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid('分镜必须为不含凭据的 HTTP(S) JSON 地址')
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) })
  if (!response.ok) throw invalid(`分镜读取失败：HTTP ${response.status}`)
  let plan
  try { plan = await response.json() } catch { throw invalid('分镜不是有效 JSON') }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || 'plan_path' in plan) throw invalid('分镜须为普通视频请求，不能嵌套 plan_path')
  for (const object of [plan, ...(Array.isArray(plan.shots) ? plan.shots : [])]) {
    if (!object || typeof object !== 'object') continue
    for (const key of ['image_path', 'video_path', 'audio_path']) if (key in object) {
      if (typeof object[key] !== 'string' || !object[key]) throw invalid('素材 HTTP 地址不能为空')
      object[key] = new URL(object[key], response.url || url).href
    }
  }
  if (Array.isArray(plan.video_paths)) plan.video_paths = plan.video_paths.map(value => {
    if (typeof value !== 'string' || !value) throw invalid('素材 HTTP 地址不能为空')
    return new URL(value, response.url || url).href
  })
  return plan
}
