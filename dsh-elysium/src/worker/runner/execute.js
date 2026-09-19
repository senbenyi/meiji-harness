// 职责：在当前进程内执行一个已受理任务：读取请求与后端快照，创建 TaskContext 交给模型层，异常时兜底写入失败。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson } from '../../database/json.js'
import { failStatus } from '../store/status.js'
import { projectJobRoot } from '../store/paths.js'
import { executeBackendJob, readBackend } from '../models/index.js'
import { createTaskContext } from './context.js'

// pause 仅供测试注入退避等待。
export async function executeTask(projectId, jobId, { signal, pause } = {}) {
  const directory = projectJobRoot(projectId, jobId)
  try {
    const request = JSON.parse(await readFile(join(directory, 'input/request.json'), 'utf8'))
    const backend = await readBackend(directory)
    const ctx = createTaskContext(projectId, jobId, { signal, provider: backend.provider })
    return await executeBackendJob(backend, request, pause ? { ...ctx, pause } : ctx)
  } catch (error) {
    // 执行器已写入终态时不覆盖：成功结果受保护，失败详情以执行器为准。
    const status = await readJson(join(directory, 'status.json')) || { job_id: jobId, project_id: projectId }
    if (!['failed', 'succeeded'].includes(status.status)) await failStatus(directory, status, error, { code: 'MODEL_GENERATION_FAILED' })
    throw error
  }
}
