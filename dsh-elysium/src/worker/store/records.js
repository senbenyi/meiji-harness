// 职责：将已路由任务的输入、来源和初始状态作为一个目录原子发布。
import { validateBackend } from '../models/index.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { saveJson } from '../../database/json.js'
import { jobsRoot } from '../../database/paths.js'
import { jobRoot, validJobId, validProjectId } from './paths.js'
import { mkdir, rename, rm } from '../../database/files.js'

export async function createJob(projectId, plan, backend, { id = randomBytes(16).toString('hex'), origin, capability } = {}) {
  if (!validProjectId(projectId)) throw new Error('项目 ID 无效')
  if (!validJobId(id)) throw new Error('任务 ID 无效')
  const provider = await validateBackend(backend)
  backend = { ...backend, provider_api_version: provider.apiVersion }
  const temporary = join(jobsRoot(), `.tmp-${randomUUID()}`)
  await mkdir(join(temporary, 'input'), { recursive: true })
  try {
    await Promise.all([
      saveJson(join(temporary, 'input/backend.json'), backend),
      saveJson(join(temporary, 'input/request.json'), plan),
      origin && saveJson(join(temporary, 'input/origin.json'), origin),
      saveJson(join(temporary, 'status.json'), { job_id: id, project_id: projectId, ...(capability ? { capability } : {}), status: 'pending', stage: 'pending', created_at: new Date().toISOString() }),
    ].filter(Boolean))
    await rename(temporary, jobRoot(id))
    return id
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function createFailedJob(projectId, plan, { id, capability, error, origin }) {
  if (!validProjectId(projectId) || !validJobId(id)) throw new Error('任务身份无效')
  const temporary = join(jobsRoot(), `.tmp-${randomUUID()}`)
  await mkdir(join(temporary, 'input'), { recursive: true })
  try {
    await Promise.all([
      saveJson(join(temporary, 'input/request.json'), plan),
      origin && saveJson(join(temporary, 'input/origin.json'), origin),
      saveJson(join(temporary, 'status.json'), { job_id: id, project_id: projectId, capability, status: 'failed', stage: 'failed', failed_stage: 'routing',
        error_code: error.code || 'MODEL_ROUTE_FAILED', error: String(error.message).slice(0, 1000), created_at: new Date().toISOString(), finished_at: new Date().toISOString() }),
    ].filter(Boolean))
    await rename(temporary, jobRoot(id))
    return id
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
