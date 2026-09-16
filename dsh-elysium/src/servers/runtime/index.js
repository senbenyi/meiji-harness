// 职责：作为业务唯一平台调度入口，按任务快照加载适配器并核验服务能力。
import { loadProvider } from './loader.js'
import { providerDefinitions } from './definitions.js'
import { resolveServer } from '../registry/resolve.js'
import { runtimeConfig } from '../../config.js'
async function adapterFor(backend) {
  const provider = await loadProvider(backend.provider)
  if (backend.provider_api_version !== undefined && backend.provider_api_version !== provider.apiVersion) throw Object.assign(new Error('任务平台接口版本不兼容'), { code: 'PROVIDER_VERSION_MISMATCH', status: 409 })
  if (!Object.hasOwn(provider.services, backend.service)) throw Object.assign(new Error('平台不支持任务所需服务'), { code: 'PROVIDER_SERVICE_UNSUPPORTED', status: 422 })
  return provider
}
async function providerFor(backend) {
  const provider = await adapterFor(backend)
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

// 唯一公共门面；外部代码不得导入内部 loader、registry、transport 或提供者实现。
export { listProviders, providerSourceFiles, runtimeSourceFiles } from './loader.js'
export { resolveServer, backendFromServer, withBackend, legacyTunnelBackend } from '../registry/resolve.js'
export { readRegistry, writeRegistry } from '../registry/store.js'
export { validateRegistry, httpUrl, serviceUrl } from '../registry/schema.js'
export { sshIdentity } from '../transport/connection.js'
export { checkServer, switchServer } from './check.js'
export { readBackend, sameBackend } from './backend.js'
export { providerConfigFields, providerConfigDefaults, providerDefaultModels, providerConfigNames, installProviderConfigs, providerEnvironment } from './definitions.js'

export const validateBackend = async backend => ({ apiVersion: (await providerFor(backend)).apiVersion })
export const validateBackendPlan = async (backend, plan) => (await adapterFor(backend)).validatePlan(plan, backend)
export const executeBackendJob = async (backend, projectId, jobId, plan, options) => (await providerFor(backend)).executeJob(projectId, jobId, plan, backend, options)
export const extractBackendReference = async (backend, options) => (await providerFor(backend)).extractReference(options)
export const syncProviderWorkflows = async (id, args) => {
  const provider = await loadProvider(id)
  if (!provider.syncWorkflows) throw new Error('所选平台未提供工作流同步')
  return provider.syncWorkflows(args)
}
// 显式兼容委托也经过入口；依赖关系由提供者自身声明。
export async function delegateProvider(id, method, ...args) {
  const target = providerDefinitions().find(item => item.id === id)?.workflow_provider
  if (!target) throw new Error('提供者未声明兼容工作流')
  const provider = await loadProvider(target)
  if (typeof provider[method] !== 'function') throw new Error('提供者未实现所需操作')
  return provider[method](...args)
}
export async function probeBackend(backend) {
  try { return !!await (await providerFor(backend)).probe(backend) } catch { return false }
}
async function channels() {
  const result = []
  for (const definition of providerDefinitions().filter(item => item.channel).sort((a, b) => a.priority - b.priority)) {
    const provider = await loadProvider(definition.id)
    result.push({ provider, ...await provider.channel() })
  }
  return result
}
// 新任务优先自有模型；三方排序读取提供者声明，旧任务只认快照。
export async function resolveGenerationBackend(kind, { probe } = {}) {
  if (runtimeConfig().ELYSIUM_BACKEND) return runtimeConfig().ELYSIUM_BACKEND
  let third
  for (const channel of await channels()) {
    if (channel.enabled) third = await channel.provider.generationBackend(kind)
    if (third) break
  }
  if (!third) return resolveServer(kind)
  try {
    const own = resolveServer(kind), provider = await providerFor(own)
    if (kind === 'image' && own.service === 'comfyui' && !provider.generateImage) throw new Error('自有图片模型尚未实现生成能力')
    if (probe ? await probe(own) : await probeBackend(own)) return own
  } catch {}
  await validateBackend(third)
  return third
}
export async function thirdPartyModels() {
  const result = {}
  for (const channel of await channels()) if (channel.enabled) for (const [kind, model] of Object.entries(channel.models)) result[kind] ||= model
  return Object.keys(result).length ? result : null
}
export async function thirdPartyChannels() {
  let preferred = false
  return (await channels()).map(({ id, label, enabled, models }) => {
    const first = enabled && !!models.video && !preferred
    preferred ||= first
    return { id, label, enabled, preferred: first, models: Object.values(models).flatMap(model => model.model_ids || [model.model]).filter(Boolean) }
  })
}
export async function providerCreationInstructions() {
  const result = []
  try {
    const provider = await providerFor(resolveServer('video'))
    const text = typeof provider.guidance === 'function' ? await provider.guidance() : provider.guidance
    if (text) result.push(text)
  } catch { /* 未配置自有模型时仍可使用独立渠道。 */ }
  for (const channel of await channels()) if (channel.enabled && channel.provider.guidance) result.push(channel.provider.guidance)
  return result.join('\n')
}

export const defaultTunnelAlias = () => providerDefinitions().find(item => item.legacy_tunnel)?.legacy_tunnel.alias
