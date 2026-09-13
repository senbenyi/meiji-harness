// 职责：校验、创建、复用和恢复会话中的视频任务。
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getJob } from '../jobs/query.js'
import { ModelTaskError } from '../jobs/errors.js'
import { bindVideoCall, findVideoCall } from './call-binding.js'
import { createJob } from '../jobs/create.js'
import { launch } from './launcher.js'
import { withLaunchLock } from '../jobs/lock.js'
import { validateVideoPlan } from './plan.js'
import { requiredConfig } from '../config.js'

export { validateVideoPlan, launch }
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

async function withVideoSessionLock(exec, callback) {
  if (!exec?.agent?.session) return callback()
  const directory = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'sessions', createHash('sha256').update(exec.agent.session.id).digest('hex'))
  await mkdir(directory, { recursive: true })
  return withLaunchLock(directory, callback, true)
}

export async function startVideoJob(args, exec) {
  return withVideoSessionLock(exec, () => startVideoJobLocked(args, exec))
}

async function startVideoJobLocked(args, exec) {
  const { new_video = false, ...plan } = args
  if (typeof new_video !== 'boolean') throw invalid('new_video 必须为布尔值')
  await validateVideoPlan(plan)
  requiredConfig('COMFYUI_URL', 'url')
  if (!new_video && exec?.agent?.session) {
    const session = exec.agent.session
    const calls = session.snapshotEvents().filter(event => event.type === 'tool/call' && ['workflow_generate_video', 'workflow_resume_video'].includes(event.data.name))
    for (const call of calls.reverse()) {
      const previous = await findVideoCall(session.id, call.data.callId, session)
      if (!previous) continue
      const job = await getJob(previous)
      if (job.status === 'succeeded') break
      await bindVideoCall(previous, exec)
      return { job_id: previous, status: job.status }
    }
  }
  const jobId = await createJob(plan)
  await bindVideoCall(jobId, exec)
  return launch(jobId)
}

export async function resumeVideoJob(jobId, exec) {
  return withVideoSessionLock(exec, () => resumeVideoJobLocked(jobId, exec))
}

async function resumeVideoJobLocked(jobId, exec) {
  const job = await getJob(jobId)
  if (job.capability !== 'workflow-video') throw invalid('只能恢复视频工作流；原子产物请按顺序导入新工作流')
  const session = exec?.agent?.session
  const events = session?.snapshotEvents() || []
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  for (const event of events.slice(turnStart + 1)) {
    if (event.type !== 'tool/call' || event.data.name !== 'workflow_resume_video' || event.data.callId === exec.callId) continue
    if (await findVideoCall(session.id, event.data.callId, session) !== jobId) continue
    await bindVideoCall(jobId, exec)
    return { job_id: jobId, status: job.status }
  }
  const result = job.status === 'succeeded' ? { job_id: jobId, status: job.status }
    : await launch(jobId, 'workflow-video', job.status === 'failed' && job.backend === 'comfyui')
  await bindVideoCall(jobId, exec)
  return result
}
