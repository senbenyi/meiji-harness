// 职责：显式检查目标服务的节点和模型，并在检查通过后原子切换默认选择。
import { ComfyClient } from '../comfyui/client.js'
import { buildVideoGraph } from '../video/graph.js'
import { resolveServer, withBackend } from './resolve.js'
import { readRegistry, writeRegistry } from './store.js'
import { ensureConnection } from './connection.js'
import { runtimeConfig } from '../config.js'
export async function checkServer(kind, id) {
  if (!['comfyui', 'llm'].includes(kind)) throw new Error('未知服务类型')
  const backend = resolveServer(kind, id)
  await ensureConnection(backend)
  if (kind === 'llm') {
    const key = backend.connection?.api_key_env
    const value = key ? runtimeConfig()[key] || process.env[key] : undefined
    if (key && !value) throw new Error(`缺少凭据环境变量：${key}`)
    const response = await fetch(`${backend.base_url}/models`, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: value ? { Authorization: `Bearer ${value}` } : {} })
    if (!response.ok) throw new Error(`LLM 模型检查失败：HTTP ${response.status}`)
    const models = await response.json()
    if (!models.data?.some(model => model.id === backend.connection.model)) throw new Error('目标缺少配置的 Qwen 模型')
  } else {
    const client = new ComfyClient(backend.base_url, AbortSignal.timeout(30000))
    await client.request('system_stats')
    await withBackend(backend, async () => {
      // 覆盖预览、常规及完整工作流的节点和模型选择，不提交生成请求。
      for (const plan of [{ profile: 'preview', mode: 't2va' }, { profile: 'regular', mode: 't2va' }, { mode: 't2va' }, { mode: 'i2va' }, { mode: 'fl2va' }, { mode: 'fl2va-loop' }, { mode: 'r2va' }]) {
        const media = `${backend.base_url}/view?filename=check.png&type=input`
        const { graph } = await buildVideoGraph({ ...plan, prompt: 'Connection check', first_frame: media, last_frame: media, reference_image_1: media, reference_image_2: media }, 'connection-check')
        await client.validate(graph, { verifyModels: true })
      }
    })
  }
  return { ok: true, server_id: backend.server_id, service: kind, checked_at: new Date().toISOString(), message: '连接与所需模型检查通过；尚未验证生成质量。' }
}
export async function switchServer(kind, id, revision, check = checkServer) {
  const registry = readRegistry()
  if (!registry || registry.revision !== revision) throw Object.assign(new Error('服务器配置版本冲突，请刷新'), { status: 409 })
  const server = registry.servers.find(item => item.id === id)
  if (!server?.services[kind] || server.disabled) throw Object.assign(new Error('目标不存在或已停用'), { status: 400 })
  const result = await check(kind, id)
  const saved = await writeRegistry({ ...registry, active: { ...registry.active, [kind]: id } }, revision)
  return { ...result, revision: saved.revision, effect: kind === 'llm' ? 'next_start' : 'new_jobs', message: kind === 'llm' ? '已保存，下次通过本机启动脚本启动 Harness 时生效。' : '新任务使用此服务器；旧任务和已开始的批次继续使用原服务器。' }
}
