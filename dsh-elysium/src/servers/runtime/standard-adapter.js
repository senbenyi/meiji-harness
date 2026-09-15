// 职责：提供可跨平台复用的 ComfyUI/H3、SSH 和 Qwen 服务协议实现。
import { ComfyClient } from '../../comfyui/client.js'
import { ensureConnection } from '../transport/connection.js'
import { runtimeConfig } from '../../config.js'
export const standardServices = Object.freeze({ comfyui: { workload: 'minimax-h3' }, llm: { model: 'qwen3.8-27b-elysium' } })
export function validateStandard(backend) {
  const service = backend.connection
  if (!standardServices[backend.service]) throw new Error('适配器不支持该服务')
  if (backend.legacy) return
  if (backend.service === 'comfyui' && (service?.workload !== standardServices.comfyui.workload || service.api_key_env || service.model)) throw new Error('需要无额外认证的 minimax-h3 ComfyUI 服务')
  if (backend.service === 'llm' && (service?.model !== standardServices.llm.model || service.workload)) throw new Error('需要兼容的 qwen3.8-27b-elysium 服务')
}
export function createStandardAdapter({ id, label, validate = validateStandard, buildGraph = async () => { throw Object.assign(new Error('该平台未提供工作流模板'), { code: 'PROVIDER_OPERATION_UNSUPPORTED', status: 422 }) }, manage = async () => { throw Object.assign(new Error('该适配器未提供服务进程管理'), { code: 'PROVIDER_OPERATION_UNSUPPORTED', status: 422 }) } }) {
  const adapter = {
    apiVersion: 1, id, label, services: standardServices, validate, manage,
    connect: backend => ensureConnection(backend),
    createClient: (backend, { signal, timing } = {}) => new ComfyClient(backend.base_url, signal, timing),
    buildGraph,
    llmSettings: backend => ({ route: 'qwen38-local', api: 'openai-completions', model: backend.connection?.model || standardServices.llm.model,
      base_url: backend.base_url, api_key_env: backend.connection?.api_key_env }),
    workflowSource: backend => backend.base_url,
    async check(backend) {
      await adapter.connect(backend)
      if (backend.service === 'llm') {
        const settings = adapter.llmSettings(backend), key = settings.api_key_env
        const value = key ? runtimeConfig()[key] || process.env[key] : undefined
        if (key && !value) throw new Error(`缺少凭据环境变量：${key}`)
        const response = await fetch(`${settings.base_url}/models`, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: value ? { Authorization: `Bearer ${value}` } : {} })
        if (!response.ok) throw new Error(`LLM 模型检查失败：HTTP ${response.status}`)
        if (!(await response.json()).data?.some(model => model.id === settings.model)) throw new Error('目标缺少配置的 Qwen 模型')
      } else {
        const client = adapter.createClient(backend, { signal: AbortSignal.timeout(30000) })
        await client.request('system_stats')
        for (const plan of [{ profile: 'preview', mode: 't2va' }, { profile: 'regular', mode: 't2va' }, ...['t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'].map(mode => ({ mode }))]) {
          const media = `${backend.base_url}/view?filename=check.png&type=input`
          const { graph } = await adapter.buildGraph(backend, { ...plan, prompt: 'Connection check', first_frame: media, last_frame: media, reference_image_1: media, reference_image_2: media }, 'connection-check')
          await client.validate(graph, { verifyModels: true })
        }
      }
      return { ok: true, server_id: backend.server_id, service: backend.service, checked_at: new Date().toISOString(), message: '连接与所需模型检查通过；尚未验证生成质量。' }
    },
  }
  return adapter
}
