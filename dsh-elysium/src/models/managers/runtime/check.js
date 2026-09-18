// 职责：经平台接口检查目标，并在检查成功后原子切换默认选择。
import { resolveServer } from '../registry/resolve.js'
import { readRegistry } from '../../../database/managers/registry.js'
import { readSelection, writeSelection } from '../../../database/managers/selection.js'
import { checkBackend } from './index.js'
export async function checkServer(kind, id) {
  if (!['comfyui', 'llm', 'analysis', 'image', 'video'].includes(kind)) throw new Error('未知服务类型')
  return checkBackend(resolveServer(kind, id), { kind })
}
export async function switchServer(kind, id, revision, check = checkServer) {
  const selectionKind = kind === 'comfyui' ? 'video' : kind
  if (!['image', 'video'].includes(selectionKind)) throw Object.assign(new Error('Elysium 只管理图片和视频模型选择'), { status: 400 })
  const registry = readRegistry()
  const selection = readSelection()
  if (!registry) throw Object.assign(new Error('未配置服务器清单'), { status: 400 })
  const server = registry.servers.find(item => item.id === id)
  if (!server?.services.comfyui || server.disabled) throw Object.assign(new Error('目标不存在或已停用'), { status: 400 })
  if (selection.selected[selectionKind] === id) {
    const result = await check(kind, id)
    return { ...result, revision: selection.revision, effect: 'new_jobs', message: '新任务使用此服务器；旧任务和已开始的批次继续使用原服务器。' }
  }
  if (selection.revision !== revision) throw Object.assign(new Error('Elysium 选择配置版本冲突，请刷新'), { status: 409 })
  if (selection.selected[selectionKind] === null) {
    const saved = await writeSelection({ ...selection, selected: { ...selection.selected, [selectionKind]: id } }, revision)
    const result = await check(kind, id)
    return { ...result, revision: saved.revision, effect: 'new_jobs', message: '新任务使用此服务器；旧任务和已开始的批次继续使用原服务器。' }
  }
  const result = await check(kind, id)
  const saved = await writeSelection({ ...selection, selected: { ...selection.selected, [selectionKind]: id } }, revision)
  return { ...result, revision: saved.revision, effect: 'new_jobs', message: '新任务使用此服务器；旧任务和已开始的批次继续使用原服务器。' }
}
