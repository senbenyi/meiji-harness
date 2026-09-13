// 职责：分配任务 ID 并持久化原始请求，不绑定 Harness 会话。
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { saveJson } from './store.js'
import { projectJobRoot, projectRoot } from './paths.js'
import { access } from 'node:fs/promises'

export async function createJob(projectId, plan) {
  await access(join(projectRoot(projectId), 'project.json'))
  const id = randomBytes(16).toString('hex')
  await saveJson(join(projectJobRoot(projectId, id), 'input/request.json'), plan)
  return id
}
