// 职责：实现百炼万相异步视频 API 平台契约。
import { guidance } from './guidance.js'
import { bailianKey, readBailian, bailianBackend } from './config.js'
import { validatePlan, executeJob } from './execution.js'
const unsupported = () => { throw Object.assign(new Error('百炼视频 API 不支持该操作'), { status: 422, code: 'PROVIDER_OPERATION_UNSUPPORTED' }) }
export function createClient(backend, { signal } = {}) {
  return { url: new URL(backend.base_url + '/'), async request(path, body) {
    const response = await fetch(`${backend.base_url}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${bailianKey(backend)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw Object.assign(new Error(`百炼请求失败：HTTP ${response.status}`), { code: 'BAILIAN_REQUEST_FAILED', http_status: response.status })
    return response.json()
  } }
}
export default { id: 'bailian', label: '百炼万相', apiVersion: 1, services: { video: {} },
  guidance, generationBackend: bailianBackend,
  preparePlan(plan, quality) {
    if (quality === 'fast') throw Object.assign(new Error('百炼万相无法区分快速创作与常规创作，请改用常规创作或自有模型'), { status: 422, code: 'PROVIDER_QUALITY_UNSUPPORTED' })
    return { ...structuredClone(plan), quality, resolution: quality === 'high' ? '1080P' : '720P' }
  },
  channel() { const config = readBailian(), ready = config && [config.video.text_model, config.video.image_model].every(model => typeof model === 'string' && model.trim()); return { id: 'bailian', label: '百炼万相', enabled: !!config, models: ready ? { video: { id: 'wan26', label: 'Wan 2.6', model: config.video.text_model, model_ids: [config.video.text_model, config.video.image_model] } } : {} } },
  validate(backend) { if (backend.service !== 'video' || backend.connection?.text_model !== 'wan2.6-t2v' || backend.connection?.image_model !== 'wan2.6-i2v') throw new Error('百炼视频配置需使用 wan2.6-t2v 和 wan2.6-i2v') },
  connect() {}, check: async () => ({ ok: true, connection_required: false }), createClient,
  buildGraph: unsupported, llmSettings: unsupported, workflowSource: unsupported, manage: unsupported,
  validatePlan, executeJob }
