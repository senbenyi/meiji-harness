// 职责：保存任务的不可变服务器快照；旧任务只按已保存的服务器证据恢复。
import { join } from 'node:path'
import { readJson, saveJson } from '../jobs/store.js'
import { httpUrl } from './schema.js'
export async function readBackend(directory) {
  const saved = await readJson(join(directory, 'input/backend.json'))
  const evidence = await Promise.all(['comfyui-workflow.json', 'comfyui-submission.json'].map(name => readJson(join(directory, name))))
  const urls = new Set(evidence.filter(Boolean).map(item => item.server_url ? httpUrl(item.server_url) : null))
  if (saved) {
    if (saved.service !== 'comfyui' || !saved.server_id || httpUrl(saved.base_url) !== saved.base_url) throw new Error('任务后端快照无效')
    urls.add(saved.base_url)
  }
  if (urls.size !== 1 || urls.has(null)) throw new Error('旧任务服务器归属缺失或冲突，禁止自动恢复')
  if (saved) return saved
  // 旧任务只绑定证据中的 URL，不关联可能已更换实例的当前默认记录。
  const backend = { server_id: 'legacy-url', provider: 'manual', service: 'comfyui', base_url: [...urls][0], legacy: true }
  await saveJson(join(directory, 'input/backend.json'), backend)
  return backend
}
