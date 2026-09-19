// 职责：创建、复用和恢复图片生成任务。
import { resolveGenerationBackend, validateBackendPlan, prepareBackendPlan } from '../../models/managers/runtime/index.js'
import { creationQuality } from '../../../config.js'
import { createJob } from '../jobs/create.js'
import { getJob } from '../jobs/query.js'
import { waitJob } from '../jobs/wait.js'
import { launch } from '../runtime/launcher.js'
import { bindJobCall, findJobCall, mediaToolNames } from '../bindings/call.js'

export async function startImageJob(projectId, plan, newImage, exec) {
  if (!/^[a-f0-9]{8}$/.test(projectId || '') || typeof newImage !== 'boolean') throw new Error('图片项目参数无效')
  const session = exec?.agent?.session
  if (!newImage && session) for (const call of session.snapshotEvents().filter(event => event.type === 'tool/call' && mediaToolNames('image').includes(event.data.name)).reverse()) {
    const previous = await findJobCall(session.id, call.data.callId, session)
    if (!previous) continue
    const current = await getJob(previous)
    if (current.project_id !== projectId) continue
    if (current.status === 'succeeded') break
    await bindJobCall(previous, exec)
    return current
  }
  const backend = await resolveGenerationBackend('image')
  const prepared = await prepareBackendPlan(backend, plan, creationQuality())
  await validateBackendPlan(backend, prepared)
  const jobId = await createJob(projectId, prepared, backend)
  await bindJobCall(jobId, exec)
  return waitJob(await launch(jobId, 'workflow-image'), exec?.signal)
}

export async function resumeImageJob(jobId, exec) {
  const job = await getJob(jobId)
  if (job.capability !== 'workflow-image') throw new Error('只能恢复图片任务')
  await bindJobCall(job.job_id, exec)
  return job.status === 'succeeded' ? job : waitJob(await launch(job.job_id, 'workflow-image'), exec?.signal)
}
