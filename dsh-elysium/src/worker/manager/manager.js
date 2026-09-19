// 职责：任务管理器：图片与视频共用的受理 → 复用 → 路由 → 建档 → 启动流水线，以及经策略校验的恢复；只返回任务句柄，等待由调用方决定。
import { validProjectId } from '../store/paths.js'
import { createJob } from '../store/records.js'
import { routeTask } from '../routing/route.js'
import { launch } from '../runner/launcher.js'
import { getJob } from '../runner/inspect.js'
import { bindJobCall, withSessionLock } from '../intake/calls.js'
import { CAPABILITIES, assertRetryAllowed, invalid, kindOf, resubmitFailed, retriedThisTurn, reusableTask } from './policy.js'

const handle = job => ({ job_id: job.job_id, project_id: job.project_id, status: job.status })

// 提交：newTask 为 true 时跳过复用，始终创建新任务。
export async function submitTask(kind, { project_id: projectId, new_task: newTask = false, ...plan }, exec) {
  exec?.signal?.throwIfAborted()
  if (!CAPABILITIES[kind]) throw invalid('任务类型无效')
  if (typeof newTask !== 'boolean') throw invalid('new_task 必须为布尔值')
  if (!validProjectId(projectId)) throw invalid('project_id 必须为 8 位项目 ID')
  return withSessionLock(exec, async () => {
    const reused = newTask ? null : await reusableTask(kind, projectId, exec)
    if (reused) {
      await bindJobCall(reused.job_id, exec)
      return handle(reused)
    }
    const { backend, plan: prepared } = await routeTask(kind, plan)
    const jobId = await createJob(projectId, prepared, backend)
    await bindJobCall(jobId, exec)
    return launch(jobId, CAPABILITIES[kind])
  })
}

// 恢复原任务：kind 省略时按任务自身类型；consent 表示用户已明确要求重试。
export async function retryTask(jobId, { kind, exec, consent = false } = {}) {
  exec?.signal?.throwIfAborted()
  return withSessionLock(exec, async () => {
    const job = await getJob(jobId)
    const taskKind = kind || kindOf(job.capability)
    assertRetryAllowed(job, taskKind, consent)
    const result = job.status === 'succeeded' || await retriedThisTurn(taskKind, jobId, exec) ? handle(job)
      : await launch(jobId, job.capability, resubmitFailed(job))
    await bindJobCall(jobId, exec)
    return result
  })
}
