// 职责：校验、创建、复用和恢复会话中的视频任务。
import { validateBackend, resolveGenerationBackend, withBackend } from '../../servers/runtime/index.js'
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
import { requiredConfig } from '../../config.js'
import { validProjectId } from '../jobs/paths.js'

export { validateVideoPlan, launch }
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

async function withVideoSessionLock(exec, callback) {
  if (!exec?.agent?.session) return callback()
  const directory = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'runtime', 'sessions', createHash('sha256').update(exec.agent.session.id).digest('hex'))
  await mkdir(directory, { recursive: true })
  return withLaunchLock(directory, callback, true)
}

export async function startVideoJob(args, exec) {
  return withVideoSessionLock(exec, () => startVideoJobLocked(args, exec))
}

async function startVideoJobLocked(args, exec) {
  const { new_video = false, project_id: projectId, ...plan } = args
  if (typeof new_video !== 'boolean') throw invalid('new_video 必须为布尔值')
  if (!validProjectId(projectId)) throw invalid('project_id 必须为 8 位项目 ID')
  if (!new_video && exec?.agent?.session) {
    const session = exec.agent.session
    const events = session.snapshotEvents()
    const turnStart = events.findLastIndex(event => event.type === 'turn/start')
    const calls = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === 'tool/call' && ['workflow_generate_video', 'workflow_resume_video'].includes(event.data.name))
    for (const { event: call, index } of calls.reverse()) {
      const previous = await findVideoCall(session.id, call.data.callId, session)
      if (!previous) continue
      const job = await getJob(previous)
      if (job.project_id !== projectId) continue
      if (job.status === 'succeeded' && index <= turnStart) break
      await bindVideoCall(previous, exec)
      return { job_id: previous, project_id: job.project_id, status: job.status }
    }
  }
  const backend = await resolveGenerationBackend('video')
  await validateBackend(backend)
  await withBackend(backend, () => validateVideoPlan(plan))
  const jobId = await createJob(projectId, plan, backend)
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
    return { job_id: jobId, project_id: job.project_id, status: job.status }
  }
  const result = job.status === 'succeeded' ? { job_id: jobId, project_id: job.project_id, status: job.status }
    : await launch(jobId, 'workflow-video', job.status === 'failed' && job.backend === 'comfyui')
  await bindVideoCall(jobId, exec)
  return result
}
