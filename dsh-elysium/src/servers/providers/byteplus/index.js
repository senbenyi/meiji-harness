// 职责：实现 BytePlus 图片与视频平台契约，不探测或管理远程连接。
import { guidance } from './guidance.js'
import { bytePlusKey, readBytePlus, bytePlusBackend } from './config.js'
import { validatePlan, executeJob, extractReference } from './execution.js'
const unsupported = () => { throw Object.assign(new Error('三方 API 不支持 ComfyUI 或服务进程操作'), { status: 422, code: 'PROVIDER_OPERATION_UNSUPPORTED' }) }
export function createClient(backend, { signal } = {}) {
  return { url: new URL(backend.base_url + '/'), async request(path, body) {
    const response = await fetch(`${backend.base_url}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${bytePlusKey(backend)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw Object.assign(new Error(`三方模型请求失败：HTTP ${response.status}`), { status: 502, code: 'BYTEPLUS_REQUEST_FAILED' })
    return response.json()
  } }
}
export default { id: 'byteplus', label: 'BytePlus 三方模型', apiVersion: 1, services: { image: {}, video: {} },
  guidance, generationBackend: bytePlusBackend,
  channel() { const config = readBytePlus(), models = {}; if (config?.image.model.trim()) models.image = { id: 'seedream', label: 'Seedream', model: config.image.model }; if (config?.video.model.trim()) models.video = { id: 'seedance2', label: 'Seedance 2.0', model: config.video.model }; return { id: 'byteplus', label: 'BytePlus · Seedance 2.0 / Seedream', enabled: !!config, models } },
  validate(backend) { if (!['image', 'video'].includes(backend.service) || !backend.connection?.model?.trim()) throw new Error('请在独立配置文件中填写三方模型 ID') },
  connect() {}, check: async () => ({ ok: true, connection_required: false }), createClient,
  buildGraph: unsupported, llmSettings: unsupported, workflowSource: unsupported, manage: unsupported,
  validatePlan, executeJob, extractReference }
