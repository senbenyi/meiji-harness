// 职责：提供可跨平台复用的 ComfyUI、SSH 和兼容 LLM 服务协议实现。
import { ComfyClient } from '../../protocols/comfyui/client.js'
import { ensureConnection } from '../transport/connection.js'
import { validatePlan as validateProtocolPlan } from '../../protocols/comfyui/plan.js'
import { runtimeConfig } from '../../../config.js'
export const standardServices = Object.freeze({ comfyui: {}, llm: {} })
export function validateStandard(backend, services = standardServices) {
  const service = backend.connection
  if (!services[backend.service]) throw new Error('适配器不支持该服务')
  if (backend.legacy) return
  if (backend.service === 'comfyui' && (!service?.workload || services.comfyui.workload && service.workload !== services.comfyui.workload || service.api_key_env || service.model)) throw new Error('需要无额外认证的 ComfyUI 工作流服务')
  if (backend.service === 'llm' && (!service?.model || services.llm.model && service.model !== services.llm.model || service.workload)) throw new Error('需要兼容的 LLM 服务')
}
export function createStandardAdapter({ id, label, services = standardServices, llmRoute, checkPlans = [{ mode: 't2va' }], validatePlan = validateProtocolPlan, validate = backend => validateStandard(backend, services), buildGraph = async () => { throw Object.assign(new Error('该平台未提供工作流模板'), { code: 'PROVIDER_OPERATION_UNSUPPORTED', status: 422 }) }, manage = async () => { throw Object.assign(new Error('该适配器未提供服务进程管理'), { code: 'PROVIDER_OPERATION_UNSUPPORTED', status: 422 }) } }) {
  const adapter = {
    apiVersion: 1, id, label, services, validate, manage, validatePlan,
    executeJob: async (projectId, jobId, plan, _backend, options) => (await import('../../../server/workflows/videos/execution.js')).executeComfyVideo(projectId, jobId, plan, options),
    extractReference: async options => (await import('../../protocols/comfyui/reference-frame.js')).extractReference(options),
    connect: backend => ensureConnection(backend),
    createClient: (backend, { signal, timing } = {}) => new ComfyClient(backend.base_url, signal, timing),
    buildGraph,
    llmSettings: backend => ({ route: llmRoute || id, api: 'openai-completions', model: backend.connection?.model || services.llm.model,
      base_url: backend.base_url, api_key_env: backend.connection?.api_key_env }),
    workflowSource: backend => backend.base_url,
    async probe(backend) {
      const settings = backend.service === 'llm' ? adapter.llmSettings(backend) : null
      const key = settings?.api_key_env && (runtimeConfig()[settings.api_key_env] || process.env[settings.api_key_env])
      const response = await fetch(`${backend.base_url}/${settings ? 'models' : 'system_stats'}`, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: key ? { Authorization: `Bearer ${key}` } : {} })
      const value = response.ok ? await response.json() : null
      return !!value && (!settings || value.data?.some(model => model.id === settings.model))
    },
    async check(backend, { kind = backend.service } = {}) {
      await adapter.connect(backend)
      if (backend.service === 'llm') {
        const settings = adapter.llmSettings(backend), key = settings.api_key_env
        const value = key ? runtimeConfig()[key] || process.env[key] : undefined
        if (key && !value) throw new Error(`缺少凭据环境变量：${key}`)
        const response = await fetch(`${settings.base_url}/models`, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: value ? { Authorization: `Bearer ${value}` } : {} })
        if (!response.ok) throw new Error(`LLM 模型检查失败：HTTP ${response.status}`)
        if (!(await response.json()).data?.some(model => model.id === settings.model)) throw new Error('目标缺少配置的文本模型')
      } else {
        const client = adapter.createClient(backend, { signal: AbortSignal.timeout(30000) })
        await client.request('system_stats')
        const plans = Array.isArray(checkPlans) ? checkPlans : checkPlans[kind] || []
        for (const plan of plans) {
          const media = `${backend.base_url}/view?filename=check.png&type=input`
          const input = plan.mode ? { ...plan, prompt: 'Connection check', first_frame: media, last_frame: media, reference_image_1: media, reference_image_2: media } : plan
          const { graph } = await adapter.buildGraph(backend, input, 'connection-check')
          await client.validate(graph, { verifyModels: true })
        }
      }
      return { ok: true, server_id: backend.server_id, service: backend.service, checked_at: new Date().toISOString(), message: '连接与所需模型检查通过；尚未验证生成质量。' }
    },
  }
  return adapter
}
