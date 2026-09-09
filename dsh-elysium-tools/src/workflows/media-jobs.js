import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { saveJson } from '../functions/comfyui/client.js'
import { getJob, ModelTaskError } from '../functions/common/task.js'
import { bindVideoCall } from '../jobs/call-index.js'
import { launch, resumeVideoJob } from './video-jobs.js'
import { waitVideoJob } from './workflow-generate-video.js'
import { validateMediaPlan } from './media-graph.js'

export async function runMediaJob(capability, params, exec) {
  const plan = { capability, params }
  await validateMediaPlan(plan)
  requiredConfig('MINIMAX_H3_COMFYUI_URL', 'url')
  requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const id = randomBytes(16).toString('hex')
  await saveJson(join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', id, 'input/request.json'), plan)
  await bindVideoCall(id, exec)
  const result = await waitVideoJob(await launch(id, 'workflow-media'), exec?.signal)
  if (result.status === 'failed') throw new ModelTaskError(result.error_code, `任务 ${id} 失败：${result.error}`, 500)
  return result
}
export async function resumeMediaJob(id, exec) {
  const job = await getJob(id)
  if (job.capability === 'workflow-video') return waitVideoJob(await resumeVideoJob(id, exec), exec?.signal)
  if (job.capability !== 'workflow-media' || job.backend !== 'comfyui') throw new ModelTaskError('MODEL_INPUT_INVALID', '仅可恢复 ComfyUI 媒体任务', 422)
  await bindVideoCall(id, exec)
  if (job.status === 'succeeded') return waitVideoJob(job, exec?.signal)
  if (job.status === 'failed') await saveJson(join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', id, 'resume-request.json'), { retry_failed: true })
  return waitVideoJob(await launch(id, 'workflow-media'), exec?.signal)
}
