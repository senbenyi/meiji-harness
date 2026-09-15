// 职责：按服务解析唯一默认目标，保留无清单安装的旧连接配置。
import { requiredConfig, runtimeConfig, withConfig } from '../../config.js'
import { readRegistry } from './store.js'
import { serviceUrl } from './schema.js'
export function resolveServer(kind = 'comfyui', serverId) {
  const registry = readRegistry()
  if (!registry) {
    if (serverId && serverId !== 'minimax-h3') throw new Error(`未知 ComfyUI 实例：${serverId}`)
    if (kind === 'llm') return { server_id: 'legacy-qwen', provider: 'manual', provider_api_version: 1, service: kind, base_url: 'http://127.0.0.1:18000/v1' }
    return { server_id: 'minimax-h3', provider: 'manual', provider_api_version: 1, service: kind, base_url: requiredConfig('COMFYUI_URL', 'url'), legacy: true }
  }
  const server = registry.servers.find(item => item.id === (serverId ?? registry.active[kind]))
  if (!server?.services[kind] || (!serverId && server.disabled)) throw new Error(`未配置可用的 ${kind} 服务器：${serverId || ''}`)
  return backendFromServer(server, kind)
}
export function backendFromServer(server, kind) {
  return { server_id: server.id, provider: server.provider, provider_api_version: 1, instance_id: server.instance_id, deployment_id: server.deployment_id,
    service: kind, base_url: serviceUrl(server.services[kind]), connection: server.services[kind] }
}

export const withBackend = (backend, callback) => withConfig({ ...runtimeConfig(), COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, callback)
