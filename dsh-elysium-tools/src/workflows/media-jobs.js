import { requiredConfig } from '../config.js'
import { createJob } from '../jobs/create.js'
import { launch } from '../jobs/launch.js'
import { ModelTaskError } from '../jobs/contracts.js'
import { getJob } from '../jobs/query.js'
import { bindVideoCall } from '../jobs/call-index.js'
import { resumeVideoJob } from './video-jobs.js'
import { waitJob } from '../jobs/wait.js'
import { validateMediaPlan } from './media-plan.js'

export async function runMediaJob(capability, params, exec) {
  const plan = { capability, params }
  await validateMediaPlan(plan)
  requiredConfig('MINIMAX_H3_COMFYUI_URL', 'url')
  requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const id = await createJob(plan, exec)
  const result = await waitJob(await launch(id, 'workflow-media'), exec?.signal)
  if (result.status === 'failed') throw new ModelTaskError(result.error_code, `任务 ${id} 失败：${result.error}`, 500)
  return result
}
export async function resumeMediaJob(id, exec) {
  const job = await getJob(id)
  if (job.capability === 'workflow-video') return waitJob(await resumeVideoJob(id, exec), exec?.signal)
  if (job.capability !== 'workflow-media' || job.backend !== 'comfyui') throw new ModelTaskError('MODEL_INPUT_INVALID', '仅可恢复 ComfyUI 媒体任务', 422)
  await bindVideoCall(id, exec)
  if (job.status === 'succeeded') return waitJob(job, exec?.signal)
  return waitJob(await launch(id, 'workflow-media', job.status === 'failed'), exec?.signal)
}
