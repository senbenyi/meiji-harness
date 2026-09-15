// 职责：分配任务 ID 并持久化原始请求，不绑定 Harness 会话。
import { providerFor } from '../servers/runtime.js'
import { resolveServer } from '../servers/resolve.js'
import { runtimeConfig } from '../config.js'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { saveJson } from './store.js'
import { projectJobRoot, projectRoot } from './paths.js'
import { access } from 'node:fs/promises'

export async function createJob(projectId, plan, backend = runtimeConfig().ELYSIUM_BACKEND || resolveServer()) {
  await access(join(projectRoot(projectId), 'project.json'))
  const provider = await providerFor(backend)
  backend = { ...backend, provider_api_version: provider.apiVersion }
  const id = randomBytes(16).toString('hex')
  await saveJson(join(projectJobRoot(projectId, id), 'input/backend.json'), backend)
  await saveJson(join(projectJobRoot(projectId, id), 'input/request.json'), plan)
  return id
}
