// 职责：为已路由的任务分配 ID，并持久化请求与后端快照；不做路由、不绑定 Harness 会话。
import { validateBackend } from '../models/index.js'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { saveJson } from '../../database/json.js'
import { projectJobRoot, projectRoot } from './paths.js'
import { access } from 'node:fs/promises'

export async function createJob(projectId, plan, backend) {
  await access(join(projectRoot(projectId), 'project.json'))
  const provider = await validateBackend(backend)
  backend = { ...backend, provider_api_version: provider.apiVersion }
  const id = randomBytes(16).toString('hex')
  await saveJson(join(projectJobRoot(projectId, id), 'input/backend.json'), backend)
  await saveJson(join(projectJobRoot(projectId, id), 'input/request.json'), plan)
  return id
}
