// 职责：模型层唯一入口：按任务快照加载适配器、核验服务能力并执行平台操作；不做新任务的路由决策。
import { loadProvider } from './catalog/loader.js'
import { providerDefinitions } from './catalog/definitions.js'
import { resolveServer } from './catalog/servers.js'
import { readRegistry, writeRegistry } from '../../database/managers/registry.js'
import { readSelection, writeSelection } from '../../database/managers/selection.js'
import { runtimeSettings, runtimeConfig } from '../../config.js'
import { completeStructured as requestStructured } from './protocols/openai/completions.js'
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
export const checkBackend = async (backend, options) => (await providerFor(backend)).check(backend, options)
export async function createBackendClient(backend, options) {
  const provider = await providerFor(backend)
  await provider.connect(backend)
  return provider.createClient(backend, options)
}
export const buildBackendGraph = async (backend, plan, jobId) => (await providerFor(backend)).buildGraph(backend, plan, jobId)
export const backendLlmSettings = async backend => (await providerFor(backend)).llmSettings(backend)
export async function completeStructured(request, options) {
  const backend = resolveServer('llm'), provider = await providerFor(backend)
  await provider.connect(backend)
  return requestStructured(provider.llmSettings(backend), request, options)
}
export const backendWorkflowSource = async backend => {
  const provider = await providerFor(backend)
  await provider.connect(backend)
  return provider.workflowSource(backend)
}
export const manageProvider = async (id, action, options) => (await loadProvider(id)).manage(action, options)

// 唯一公共门面；外部代码不得导入内部 loader、registry、transport 或提供者实现。
export { VIDEO_MODES, VIDEO_PROFILES, MODE_MEDIA } from './contract.js'
export { listProviders, providerSourceFiles } from './catalog/loader.js'
export { resolveServer, backendFromServer, withBackend, legacyTunnelBackend } from './catalog/servers.js'
export { readRegistry, writeRegistry }
export { readSelection, writeSelection }
export { validateRegistry, httpUrl, serviceUrl } from './catalog/registry-schema.js'
export { sshIdentity } from './catalog/transport.js'
export { checkServer, switchServer } from './catalog/check.js'
export { readBackend, sameBackend } from './catalog/backend.js'
export { providerConfigFields, providerConfigDefaults, providerConfigSources } from './catalog/definitions.js'
export { ensureSettings, readSettings, updateSettings, validateSettings } from '../../database/managers/settings.js'

export const validateBackend = async backend => ({ apiVersion: (await providerFor(backend)).apiVersion })
export const validateBackendPlan = async (backend, plan) => (await adapterFor(backend)).validatePlan(plan, backend)
export const prepareBackendPlan = async (backend, plan, quality) => (await adapterFor(backend)).preparePlan(plan, quality, backend)
export const executeBackendJob = async (backend, plan, ctx) => (await providerFor(backend)).executeJob(plan, backend, ctx)
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
    try { result.push({ provider, ...await provider.channel() }) }
    catch (error) {
      if (error.code !== 'PROVIDER_CONFIG_INVALID') throw error
      result.push({ provider, id: provider.id, label: provider.label, enabled: false, models: {} })
    }
  }
  return result
}
// 渠道清单只暴露普通数据；路由通过 channelBackend 取得三方后端快照。
export const listChannels = async () => (await channels()).map(({ provider, ...channel }) => channel)
export async function channelBackend(id, kind, model) {
  const provider = await loadProvider(id)
  return provider.generationBackend?.(kind, model)
}
// ComfyUI 自有图片服务需要平台显式声明图片生成能力。
export const canGenerate = async (backend, kind) => kind !== 'image' || backend.service !== 'comfyui' || !!(await providerFor(backend)).generateImage
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

export function defaultTunnelModel() {
  if (runtimeConfig().ELYSIUM_SETTINGS_FILE) {
    const chat = runtimeSettings().chat
    return { alias: chat.tunnel.alias, id: chat.id, label: chat.label }
  }
  const owner = providerDefinitions().find(item => item.legacy_tunnel)
  const tunnel = owner?.legacy_tunnel, model = owner?.services?.[tunnel?.service]?.model
  return tunnel && model ? { alias: tunnel.alias, id: model, label: tunnel.label || model } : null
}
export const defaultTunnelAlias = () => defaultTunnelModel()?.alias
