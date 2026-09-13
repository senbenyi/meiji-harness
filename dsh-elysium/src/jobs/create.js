// 职责：分配任务 ID 并持久化原始请求，不绑定 Harness 会话。
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { saveJson } from './store.js'

export async function createJob(plan) {
  const id = randomBytes(16).toString('hex')
  await saveJson(join(requiredConfig('ELYSIUM_STATE_ROOT'), 'jobs', id, 'input/request.json'), plan)
  return id
}
