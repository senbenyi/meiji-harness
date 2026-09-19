// 职责：按服务解析唯一默认目标，保留无清单安装的旧连接配置。
import { requiredConfig, runtimeConfig, runtimeSettings, withConfig } from '../../../config.js'
import { readRegistry } from '../../../database/managers/registry.js'
import { readSelection } from '../../../database/managers/selection.js'
import { providerDefinitions } from './definitions.js'
import { sshIdentity } from './transport.js'
import { serviceUrl } from './registry-schema.js'
export function resolveServer(kind = 'comfyui', serverId) {
  const serviceKind = ['image', 'video'].includes(kind) ? 'comfyui' : kind === 'analysis' ? 'llm' : kind
  const registry = readRegistry()
  if (!registry || !registry.servers.length) {
    if (kind === 'image') throw new Error('未配置图片模型')
    if (serviceKind === 'llm' && runtimeConfig().ELYSIUM_SETTINGS_FILE) {
      const backend = runtimeSettings().chat.backend
      if (serverId && serverId !== backend.server_id) throw new Error(`未知 llm 实例：${serverId}`)
      return { ...structuredClone(backend), provider_api_version: 1, legacy: true }
    }
    const owner = providerDefinitions().find(item => item.legacy?.[serviceKind]), legacy = owner?.legacy[serviceKind]
    if (!legacy || serverId && serverId !== legacy.server_id) throw new Error(`未知 ${serviceKind === 'comfyui' ? 'ComfyUI' : serviceKind} 实例：${serverId || ''}`)
    const { url_env, ...backend } = legacy
    return { ...backend, provider: owner.id, provider_api_version: 1, base_url: url_env ? requiredConfig(url_env, 'url') : backend.base_url, legacy: true }
  }
  const selection = readSelection()
  const selected = ['image', 'video'].includes(kind)
    ? selection.selected[kind] ?? registry.active?.[kind] ?? (kind === 'video' ? registry.active?.comfyui : undefined)
    : kind === 'comfyui' ? selection.selected.video ?? registry.active?.video ?? registry.active?.comfyui
      : registry.active?.[kind] ?? (kind === 'analysis' ? registry.active?.llm : undefined)
  const server = registry.servers.find(item => item.id === (serverId ?? selected))
  if (!server?.services[serviceKind] || (!serverId && server.disabled)) throw new Error(`未配置可用的 ${kind} 服务器：${serverId || ''}`)
  return backendFromServer(server, serviceKind)
}
export function backendFromServer(server, kind) {
  return { server_id: server.id, provider: server.provider, provider_api_version: 1, instance_id: server.instance_id, deployment_id: server.deployment_id,
    service: kind, base_url: serviceUrl(server.services[kind]), connection: server.services[kind] }
}

export const withBackend = (backend, callback) => withConfig({ ...runtimeConfig(), COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, callback)

// 兼容命令和隧道参数由提供者声明，宿主只请求连接。
export function legacyTunnelBackend(alias) {
  if (runtimeConfig().ELYSIUM_SETTINGS_FILE) {
    const chat = runtimeSettings().chat
    if (chat.tunnel.alias !== alias) return null
    return { ...structuredClone(chat.backend), provider_api_version: 1, legacy: true, instance_id: 'legacy', deployment_id: alias,
      connection: { ...chat.backend.connection, ...chat.tunnel, ssh_identity: sshIdentity(chat.tunnel.ssh_alias) } }
  }
  const owner = providerDefinitions().find(item => item.legacy_tunnel?.alias === alias)
  if (!owner) return null
  const config = owner.legacy_tunnel
  if (readRegistry()) return resolveServer(config.service)
  const backend = resolveServer(config.service)
  return { ...backend, instance_id: 'legacy', deployment_id: alias, connection: { ...config.connection, ssh_identity: sshIdentity(config.connection.ssh_alias) } }
}
