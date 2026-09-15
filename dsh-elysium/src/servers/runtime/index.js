// 职责：作为业务唯一平台调度入口，按任务快照加载适配器并核验服务能力。
import { loadProvider } from './loader.js'
export async function providerFor(backend) {
  const provider = await loadProvider(backend.provider)
  if (backend.provider_api_version !== undefined && backend.provider_api_version !== provider.apiVersion) throw Object.assign(new Error('任务平台接口版本不兼容'), { code: 'PROVIDER_VERSION_MISMATCH', status: 409 })
  if (!Object.hasOwn(provider.services, backend.service)) throw Object.assign(new Error('平台不支持任务所需服务'), { code: 'PROVIDER_SERVICE_UNSUPPORTED', status: 422 })
  try { await provider.validate(backend) } catch (error) { error.status ||= 422; throw error }
  return provider
}
export const connectBackend = async backend => (await providerFor(backend)).connect(backend)
export const checkBackend = async backend => (await providerFor(backend)).check(backend)
export async function createBackendClient(backend, options) {
  const provider = await providerFor(backend)
  await provider.connect(backend)
  return provider.createClient(backend, options)
}
export const buildBackendGraph = async (backend, plan, jobId) => (await providerFor(backend)).buildGraph(backend, plan, jobId)
export const backendLlmSettings = async backend => (await providerFor(backend)).llmSettings(backend)
export const backendWorkflowSource = async backend => {
  const provider = await providerFor(backend)
  await provider.connect(backend)
  return provider.workflowSource(backend)
}
export const manageProvider = async (id, action, options) => (await loadProvider(id)).manage(action, options)

// 新任务先只读探测自有模型，未连接才选择三方；已提交任务不切换。
export async function resolveGenerationBackend(kind, { probe } = {}) {
  const { runtimeConfig } = await import('../../config.js')
  if (runtimeConfig().ELYSIUM_BACKEND) return runtimeConfig().ELYSIUM_BACKEND
  const { resolveServer } = await import('../registry/resolve.js')
  const { bytePlusBackend } = await import('../providers/byteplus/config.js')
  const third = bytePlusBackend(kind)
  if (!third) return resolveServer(kind)
  let failure
  try {
    const own = resolveServer(kind), provider = await providerFor(own)
    if (kind === 'image' && own.service === 'comfyui' && !provider.generateImage) throw new Error('自有图片模型尚未实现生成能力')
    const connected = probe ? await probe(own) : await fetch(`${own.base_url}/system_stats`, { signal: AbortSignal.timeout(5000), redirect: 'error' }).then(async response => response.ok && !!(await response.json()))
    if (connected) return own
    failure = new Error('自有模型未连接')
  } catch (error) { failure = error }
  if (third) { await providerFor(third); return third }
  throw failure || new Error('未配置可用生成模型')
}

// 只向界面提供三方模型名称，不返回凭据或连接状态。
export async function thirdPartyModels() {
  const { readBytePlus } = await import('../providers/byteplus/config.js')
  const config = readBytePlus()
  return config ? { image: { id: 'seedream', label: 'Seedream', model: config.image.model }, video: { id: 'seedance2', label: 'Seedance 2.0', model: config.video.model } } : null
}
