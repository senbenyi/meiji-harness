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
