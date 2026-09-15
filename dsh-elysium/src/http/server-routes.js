// 职责：提供共用页面 token 认证的手工服务器登记、检查与切换接口。
import { withConfig } from '../config.js'
import { readRegistry, writeRegistry } from '../servers/store.js'
import { validateRegistry } from '../servers/schema.js'
import { sshIdentity } from '../servers/connection.js'
import { checkServer, switchServer } from '../servers/check.js'
import { authenticated, invalidRequest, json, readJsonBody } from './shared.js'
export const SERVER_ROUTE = '/plugins/dsh-elysium/server'
const actions = ['list', 'register', 'check', 'switch', 'set-enabled']
export function createServerHandler({ token, currentLlm = null, check = checkServer, identify = sshIdentity }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(SERVER_ROUTE.length + 1)
      if (!actions.includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (action === 'list' ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      const registry = readRegistry() || { version: 1, revision: 0, active: {}, servers: [] }
      if (action === 'list') return json(res, 200, { revision: registry.revision, active: registry.active, legacy: registry.revision === 0,
        current_llm: currentLlm, pending_llm: registry.active.llm && registry.active.llm !== currentLlm ? registry.active.llm : null,
        servers: registry.servers.map(server => ({ id: server.id, label: server.label, provider: server.provider, disabled: !!server.disabled,
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
