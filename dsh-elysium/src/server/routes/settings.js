// 职责：提供共用页面 token 认证的私有服务器与三方模型选择接口。
import { listProviders, validateBackend, probeBackend, thirdPartyModels, thirdPartyChannels, thirdPartySelection, selectThirdPartyModel, backendFromServer, resolveServer, readRegistry, writeRegistry, readSelection, validateRegistry, sshIdentity, checkServer, switchServer, checkBackend, legacyTunnelBackend, defaultTunnelModel } from '../../models/managers/runtime/index.js'
import { withConfig, runtimeConfig, defaultModels } from '../../config.js'
import { authenticated, invalidRequest, json, readJsonBody } from '../http.js'
export const SETTINGS_ROUTE = '/plugins/dsh-elysium/settings'
const actions = ['list', 'register', 'check', 'switch', 'set-enabled', 'models', 'model-status', 'model-connect', 'tunnel-connect', 'third-party-select']
function bindPrivateModels(models, registry) {
  const fallback = (registry?.servers || []).filter(server => !server.disabled && server.services?.comfyui)
  const serverId = fallback.length === 1 ? fallback[0].id : undefined
  return Object.fromEntries(['image', 'video'].map(kind => [kind, (models[kind] || []).map(model => model.server_id || !serverId ? model : { ...model, server_id: serverId })]))
}
export function createSettingsHandler({ token, check = checkServer, identify = sshIdentity, connect = checkBackend, tunnelBackend = legacyTunnelBackend }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(SETTINGS_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'models'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      const registry = readRegistry() || { version: 1, revision: 0, active: {}, servers: [] }
      const selection = readSelection()
      const configuredModels = runtimeConfig().ELYSIUM_MODELS || defaultModels
      const models = bindPrivateModels(Object.fromEntries(['image', 'video'].map(kind => [kind, configuredModels[kind] || []])), registry)
      if (action === 'models') {
        const thirdParty = await thirdPartyModels()
        const tunnel = defaultTunnelModel(), chatModel = tunnel && { id: tunnel.id, label: tunnel.label }
        const selected = Object.fromEntries(['image', 'video'].map(kind => {
          const entries = models[kind] || []
          if (selection.selected[kind] === null) return [kind, '']
          const active = selection.selected[kind] ?? registry.active?.[kind] ?? (kind === 'video' ? registry.active?.comfyui : undefined)
          return [kind, entries.find(model => model.server_id === active)?.id || '']
        }))
        const origin = Object.fromEntries(['image', 'video'].map(kind => [kind, selection.selected[kind] === null ? 'third' : selected[kind] ? 'own' : '']))
        return json(res, 200, { revision: selection.revision, models, chat_model: chatModel, third_party: thirdParty, third_party_selected: thirdPartySelection(thirdParty, selection), third_party_channels: await thirdPartyChannels(), selected, origin })
      }
      if (action === 'tunnel-connect') {
        const body = await readJsonBody(req), tunnel = defaultTunnelModel()
        if (!tunnel || body.id !== tunnel.id) throw invalidRequest('聊天模型未在系统中配置')
        const backend = tunnelBackend(tunnel.alias)
        if (!backend) throw invalidRequest('聊天模型隧道未配置')
        return json(res, 200, { ...await connect(backend), connected: true })
      }
      if (action === 'third-party-select') {
        const body = await readJsonBody(req)
        if (!Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.id !== 'string') throw invalidRequest('三方模型选择参数无效')
        return json(res, 200, await selectThirdPartyModel(body.kind, body.id, body.revision))
      }
      if (['model-status', 'model-connect'].includes(action)) {
        const body = await readJsonBody(req)
        const model = models[body.kind]?.find(model => model.id === body.id)
        if (!model) throw invalidRequest('模型未在系统配置中配置')
        const backend = resolveServer(body.kind, model.server_id)
        if (action === 'model-status') {
          return json(res, 200, { connected: await probeBackend(backend) })
        }
        const result = readRegistry()?.servers.length
          ? await switchServer(body.kind, backend.server_id, body.revision, check)
          : await check(body.kind, backend.server_id)
        return json(res, 200, { ...result, connected: true })
      }
      const providers = action === 'list' ? await listProviders() : []
      if (action === 'list') return json(res, 200, { providers, revision: registry.revision, selection_revision: selection.revision,
        servers: registry.servers.map(server => ({ id: server.id, label: server.label, provider: server.provider, provider_available: providers.some(provider => provider.id === server.provider && provider.available), disabled: !!server.disabled,
          services: Object.entries(server.services).map(([kind, service]) => ({ kind, transport: service.transport })) })) })
      const body = await readJsonBody(req)
      if (action === 'check') {
        if (!registry.servers.some(server => server.id === body.id && !server.disabled && server.services[body.service])) throw invalidRequest('目标不存在或已停用')
        return json(res, 200, await check(body.service, body.id))
      }
      if (action === 'switch') {
        if (!Number.isSafeInteger(body.selection_revision) || body.selection_revision < 0) throw invalidRequest('需要选择配置 revision')
        return json(res, 200, await switchServer(body.service, body.id, body.selection_revision, check))
      }
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw invalidRequest('需要配置 revision')
      if (action === 'register') {
        const server = structuredClone(body.server)
        if (!server || !server.services) throw invalidRequest('需要服务器连接信息')
        for (const service of Object.values(server.services)) if (service?.transport === 'ssh') service.ssh_identity = '0'.repeat(64)
        validateRegistry({ ...registry, servers: [...registry.servers, server] })
        for (const kind of Object.keys(server.services)) await validateBackend(backendFromServer(server, kind))
        for (const service of Object.values(server.services)) if (service.transport === 'ssh') service.ssh_identity = identify(service.ssh_alias)
        const saved = await writeRegistry({ ...registry, servers: [...registry.servers, server] }, body.revision)
        return json(res, 201, { id: server.id, revision: saved.revision, message: '已登记。检查并设为默认后，新任务才使用此服务器。' })
      }
      if (typeof body.enabled !== 'boolean' || !registry.servers.some(server => server.id === body.id)) throw invalidRequest('停用参数无效')
      if (!body.enabled && Object.values(selection.selected).includes(body.id)) throw invalidRequest('请先切换使用此连接的图片或视频模型')
      const saved = await writeRegistry({ ...registry, servers: registry.servers.map(server => server.id === body.id ? { ...server, disabled: !body.enabled } : server) }, body.revision)
      return json(res, 200, { revision: saved.revision, message: body.enabled ? '已启用。' : '已停用新任务选择；历史记录和原任务连接保留。' })
    } catch (error) {
      // 上游响应可能包含私有信息，只有本地校验错误可以原样返回。
      json(res, error.status || 503, { error: error.status ? error.message : '目标检查或连接失败，默认选择未变更；请检查本机配置与服务所需节点、模型。' })
    }
  }
}
export function registerSettingsRoutes(ctx, runtime, token) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createSettingsHandler({ token })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of actions) ctx.effect(() => server.register({ kind: 'exact', path: `${SETTINGS_ROUTE}/${suffix}`, handler }), `elysium settings ${suffix}`)
}
