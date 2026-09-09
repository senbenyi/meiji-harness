import { getJob } from '../jobs/query.js'
import { ModelTaskError } from '../jobs/contracts.js'
import { bindVideoCall } from '../jobs/call-index.js'
import { createJob } from '../jobs/create.js'
import { launch } from '../jobs/launch.js'
import { validateVideoPlan } from './video-plan.js'
import { requiredConfig } from '../config.js'
import { resolveVideoPlan } from './video-plan-file.js'

export { validateVideoPlan, launch }
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export async function startVideoJob(args, exec) {
  args = await resolveVideoPlan(args, exec?.signal)
  await validateVideoPlan(args)
  requiredConfig('MINIMAX_H3_COMFYUI_OUTPUT_ROOT')
  requiredConfig('MINIMAX_H3_COMFYUI_URL', 'url')
  requiredConfig('MINIMAX_H3_COMFYUI_PUBLIC_URL', 'url')
  const jobId = await createJob(args, exec)
  return launch(jobId)
}

export async function resumeVideoJob(jobId, exec) {
  const job = await getJob(jobId)
  if (job.capability !== 'workflow-video') throw invalid('只能恢复视频工作流；原子产物请按顺序导入新工作流')
  const result = job.status === 'succeeded' ? { job_id: jobId, status: job.status }
    : await launch(jobId, 'workflow-video', job.status === 'failed' && job.backend === 'comfyui')
  await bindVideoCall(jobId, exec)
  return result
}
