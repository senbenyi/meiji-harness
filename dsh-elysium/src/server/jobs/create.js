// 职责：分配任务 ID 并持久化原始请求，不绑定 Harness 会话。
import { validateBackend, resolveServer } from '../../models/managers/runtime/index.js'
import { runtimeConfig } from '../../config.js'
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import { readJson, saveJson } from '../../database/json.js'
import { FREE_PROJECT_ID, projectJobRoot, projectRoot } from './paths.js'
import { access, mkdir } from 'node:fs/promises'

const freeSetups = new Map()

// 自由和教学模式使用不可见的内部工作区保存任务和媒体，不创建用户项目。
export async function ensureFreeProject() {
  const root = projectRoot(FREE_PROJECT_ID)
  if (!freeSetups.has(root)) freeSetups.set(root, (async () => {
    await mkdir(root, { recursive: true })
    const metadata = await readJson(join(root, 'project.json'))
    if (metadata && metadata.internal !== 'free') throw new Error('自由创作内部工作区 ID 已被占用')
    await Promise.all(['jobs', 'production', 'media'].map(name => mkdir(join(root, name), { recursive: true })))
    if (!metadata) await Promise.all([
      saveJson(join(root, 'project.json'), { id: FREE_PROJECT_ID, title: '自由创作', director: null, profile: 'preview', internal: 'free', created_at: Date.now(), updated_at: Date.now() }),
      saveJson(join(root, 'materials.json'), []),
      saveJson(join(root, 'anchors.json'), []),
      saveJson(join(root, 'storyboard.json'), []),
      saveJson(join(root, 'deliverables.json'), []),
      saveJson(join(root, 'media', 'manifest.json'), { version: 1, project_id: FREE_PROJECT_ID, complete: false, files: [], missing: [] }),
    ])
    return FREE_PROJECT_ID
  })().catch(error => { freeSetups.delete(root); throw error }))
  return freeSetups.get(root)
}

export async function createJob(projectId, plan, backend = runtimeConfig().ELYSIUM_BACKEND || resolveServer(), reservedId) {
  await access(join(projectRoot(projectId), 'project.json'))
  const provider = await validateBackend(backend)
  backend = { ...backend, provider_api_version: provider.apiVersion }
  const id = reservedId || randomBytes(16).toString('hex')
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('任务身份无效')
  if (reservedId) {
    const existing = await readJson(join(projectJobRoot(projectId, id), 'input/request.json'))
    if (existing) {
      const savedBackend = await readJson(join(projectJobRoot(projectId, id), 'input/backend.json'))
      if (!isDeepStrictEqual(existing, plan) || !isDeepStrictEqual(savedBackend, backend)) throw new Error('已存在任务的输入或后端不能改变')
      return id
    }
  }
  await saveJson(join(projectJobRoot(projectId, id), 'input/backend.json'), backend)
  await saveJson(join(projectJobRoot(projectId, id), 'input/request.json'), plan)
  return id
}
