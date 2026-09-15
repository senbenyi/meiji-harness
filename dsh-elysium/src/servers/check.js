// 职责：经平台接口检查目标，并在检查成功后原子切换默认选择。
import { resolveServer } from './resolve.js'
import { readRegistry, writeRegistry } from './store.js'
import { checkBackend } from './runtime.js'
export async function checkServer(kind, id) {
  if (!['comfyui', 'llm'].includes(kind)) throw new Error('未知服务类型')
  return checkBackend(resolveServer(kind, id))
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
