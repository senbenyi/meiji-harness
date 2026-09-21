// 职责：受理未指定项目的任务，将其写入不可见的内部工作区。
import { mkdir } from '../../database/files.js'
import { join } from 'node:path'
import { readJson, saveJson } from '../../database/json.js'
import { FREE_PROJECT_ID, projectRoot } from '../store/paths.js'

const freeSetups = new Map()

// 未指定项目时使用内部工作区保存任务和媒体。
export async function ensureFreeProject() {
  const root = projectRoot(FREE_PROJECT_ID)
  if (!freeSetups.has(root)) freeSetups.set(root, (async () => {
    await mkdir(root, { recursive: true })
    const metadata = await readJson(join(root, 'project.json'))
    if (metadata && metadata.internal !== 'free') throw new Error('自由创作内部工作区 ID 已被占用')
    await mkdir(join(root, 'media'), { recursive: true })
    if (!metadata) await Promise.all([
      saveJson(join(root, 'project.json'), { id: FREE_PROJECT_ID, title: '自由创作', director: null, internal: 'free', created_at: Date.now(), updated_at: Date.now() }),
      saveJson(join(root, 'materials.json'), []),
      saveJson(join(root, 'anchors.json'), []),
      saveJson(join(root, 'media', 'manifest.json'), { version: 1, project_id: FREE_PROJECT_ID, complete: false, files: [], missing: [] }),
    ])
    return FREE_PROJECT_ID
  })().catch(error => { freeSetups.delete(root); throw error }))
  return freeSetups.get(root)
}
