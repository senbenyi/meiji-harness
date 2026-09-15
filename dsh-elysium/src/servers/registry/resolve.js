// 职责：按服务解析唯一默认目标，保留无清单安装的旧连接配置。
import { requiredConfig, runtimeConfig, withConfig } from '../../config.js'
import { readRegistry } from './store.js'
import { serviceUrl } from './schema.js'
export function resolveServer(kind = 'comfyui', serverId) {
  const serviceKind = ['image', 'video'].includes(kind) ? 'comfyui' : kind
  const registry = readRegistry()
  if (!registry) {
    if (kind === 'image') throw new Error('未配置图片模型')
    if (serverId && serverId !== (kind === 'llm' ? 'legacy-qwen' : 'minimax-h3')) throw new Error(`${kind === 'llm' ? '未知聊天模型' : '未知 ComfyUI'}实例：${serverId}`)
    if (kind === 'llm') return { server_id: 'legacy-qwen', provider: 'manual', provider_api_version: 1, service: kind, base_url: 'http://127.0.0.1:18000/v1', legacy: true,
      connection: { model: 'qwen3.8-27b-elysium', api_key_env: 'QWEN38_LOCAL_API_KEY' } }
    return { server_id: 'minimax-h3', provider: 'manual', provider_api_version: 1, service: serviceKind, base_url: requiredConfig('COMFYUI_URL', 'url'), legacy: true }
  }
  const selected = kind === 'comfyui' ? registry.active.video ?? registry.active.comfyui : registry.active[kind] ?? (kind === 'video' ? registry.active.comfyui : undefined)
  const server = registry.servers.find(item => item.id === (serverId ?? selected))
  if (!server?.services[serviceKind] || (!serverId && server.disabled)) throw new Error(`未配置可用的 ${kind} 服务器：${serverId || ''}`)
  return backendFromServer(server, serviceKind)
}
export function backendFromServer(server, kind) {
  return { server_id: server.id, provider: server.provider, provider_api_version: 1, instance_id: server.instance_id, deployment_id: server.deployment_id,
    service: kind, base_url: serviceUrl(server.services[kind]), connection: server.services[kind] }
}

export const withBackend = (backend, callback) => withConfig({ ...runtimeConfig(), COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, callback)
