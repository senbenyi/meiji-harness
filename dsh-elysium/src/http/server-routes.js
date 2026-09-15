// 职责：提供共用页面 token 认证的手工服务器登记、检查与切换接口。
import { listProviders } from '../servers/runtime/loader.js'
import { providerFor, backendLlmSettings, thirdPartyModels } from '../servers/runtime/index.js'
import { backendFromServer, resolveServer } from '../servers/registry/resolve.js'
import { withConfig, runtimeConfig, defaultModels } from '../config.js'
import { readRegistry, writeRegistry } from '../servers/registry/store.js'
import { validateRegistry } from '../servers/registry/schema.js'
import { sshIdentity } from '../servers/transport/connection.js'
import { checkServer, switchServer } from '../servers/runtime/check.js'
import { authenticated, invalidRequest, json, readJsonBody } from './shared.js'
export const SERVER_ROUTE = '/plugins/dsh-elysium/server'
const actions = ['list', 'register', 'check', 'switch', 'set-enabled', 'models', 'model-status', 'model-connect']
export function createServerHandler({ token, currentLlm = null, check = checkServer, identify = sshIdentity }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(SERVER_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'models'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      const registry = readRegistry() || { version: 1, revision: 0, active: {}, servers: [] }
      const models = runtimeConfig().ELYSIUM_MODELS || defaultModels
      if (action === 'models') return json(res, 200, { revision: registry.revision, models, third_party: await thirdPartyModels(), selected: Object.fromEntries(Object.entries(models).map(([kind, entries]) => {
        const active = registry.active[kind] ?? (kind === 'video' ? registry.active.comfyui : kind === 'analysis' ? registry.active.llm : undefined)
        return [kind, (entries.find(model => model.server_id === active) || entries[0])?.id || '']
      })), pending_llm: !!registry.active.llm && registry.active.llm !== currentLlm })
      if (['model-status', 'model-connect'].includes(action)) {
        const body = await readJsonBody(req)
        const model = models[body.kind]?.find(model => model.id === body.id)
        if (!model) throw invalidRequest('模型未在系统配置中配置')
        const backend = resolveServer(body.kind, model.server_id)
        if (action === 'model-status') {
          // 状态查询只探测现有地址，不建立 SSH 连接或切换默认目标。
          try {
            const settings = backend.service === 'llm' ? await backendLlmSettings(backend) : null
            const key = settings?.api_key_env && (runtimeConfig()[settings.api_key_env] || process.env[settings.api_key_env])
            const response = await fetch(`${backend.base_url}/${settings ? 'models' : 'system_stats'}`, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: key ? { Authorization: `Bearer ${key}` } : {} })
            const value = response.ok ? await response.json() : null
            const connected = !!value && (!settings || value.data?.some(item => item.id === settings.model))
            return json(res, 200, { connected: !!connected })
          } catch { return json(res, 200, { connected: false }) }
        }
        const result = readRegistry()
          ? await switchServer(body.kind, backend.server_id, body.revision, check)
          : await check(body.kind, backend.server_id)
        return json(res, 200, { ...result, connected: true, pending: body.kind === 'llm' && !!readRegistry() && backend.server_id !== currentLlm })
      }
      const providers = action === 'list' ? await listProviders() : []
      if (action === 'list') return json(res, 200, { providers, revision: registry.revision, active: registry.active, legacy: registry.revision === 0,
        current_llm: currentLlm, pending_llm: registry.active.llm && registry.active.llm !== currentLlm ? registry.active.llm : null,
        servers: registry.servers.map(server => ({ id: server.id, label: server.label, provider: server.provider, provider_available: providers.some(provider => provider.id === server.provider && provider.available), disabled: !!server.disabled,
          services: Object.entries(server.services).map(([kind, service]) => ({ kind, transport: service.transport })) })) })
      const body = await readJsonBody(req)
      if (action === 'check') {
        if (!registry.servers.some(server => server.id === body.id && !server.disabled && server.services[body.service])) throw invalidRequest('目标不存在或已停用')
        return json(res, 200, await check(body.service, body.id))
      }
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw invalidRequest('需要配置 revision')
      if (action === 'switch') return json(res, 200, await switchServer(body.service, body.id, body.revision, check))
      if (action === 'register') {
        const server = structuredClone(body.server)
        if (!server || !server.services) throw invalidRequest('需要服务器连接信息')
        for (const service of Object.values(server.services)) if (service?.transport === 'ssh') service.ssh_identity = '0'.repeat(64)
        validateRegistry({ ...registry, servers: [...registry.servers, server] })
        for (const kind of Object.keys(server.services)) await providerFor(backendFromServer(server, kind))
        for (const service of Object.values(server.services)) if (service.transport === 'ssh') service.ssh_identity = identify(service.ssh_alias)
        const saved = await writeRegistry({ ...registry, servers: [...registry.servers, server] }, body.revision)
        return json(res, 201, { id: server.id, revision: saved.revision, message: '已登记。检查并设为默认后，新任务才使用此服务器。' })
      }
      if (typeof body.enabled !== 'boolean' || !registry.servers.some(server => server.id === body.id)) throw invalidRequest('停用参数无效')
      const saved = await writeRegistry({ ...registry, servers: registry.servers.map(server => server.id === body.id ? { ...server, disabled: !body.enabled } : server) }, body.revision)
      return json(res, 200, { revision: saved.revision, message: body.enabled ? '已启用。' : '已停用新任务选择；历史记录和原任务连接保留。' })
    } catch (error) {
      // 上游响应可能包含私有信息，只有本地校验错误可以原样返回。
      json(res, error.status || 503, { error: error.status ? error.message : '目标检查或连接失败，默认选择未变更；请检查本机配置与服务所需节点、模型。' })
    }
  }
}
export function registerServerRoutes(ctx, runtime, token) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createServerHandler({ token, currentLlm: process.env.ELYSIUM_LLM_SERVER_ID || null })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of actions) ctx.effect(() => server.register({ kind: 'exact', path: `${SERVER_ROUTE}/${suffix}`, handler }), `elysium server ${suffix}`)
}
