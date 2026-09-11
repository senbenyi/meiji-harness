import { startVideoJob, resumeVideoJob } from './video-jobs.js'
import { VIDEO_MODES } from './video-plan.js'
import { renderToolDebug } from '../functions/common/tool.js'
import { MODEL_TIMEOUTS } from '../jobs/contracts.js'
import { waitJob } from '../jobs/wait.js'

export { waitJob as waitVideoJob } from '../jobs/wait.js'

const output = { schema: { type: 'object', properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }
const media = description => ({ type: 'string', description: `${description}，必须是当前 RunPod 的 ComfyUI /view URL。` })

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '使用 RunPod 现有 MiniMax H3 工作流生成视频。仅支持 t2va、i2va、fl2va、fl2va-loop、r2va；工作流内模型、参数、帧率和后处理保持 RunPod 原值。',
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    parameters: { type: 'object', additionalProperties: false, required: ['mode', 'prompt'], properties: {
      mode: { type: 'string', enum: VIDEO_MODES },
      prompt: { type: 'string', minLength: 1 },
      first_frame: media('I2VA/FL2VA 首帧'),
      last_frame: media('FL2VA 尾帧'),
      reference_image_1: media('R2VA 第一张参考图'),
      reference_image_2: media('R2VA 第二张参考图'),
    } }, output,
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitJob(await startVideoJob(args, exec), exec?.signal)
    },
  }
}

export function createWorkflowResumeVideoTool() {
  return { name: 'workflow_resume_video', description: '恢复原 RunPod 视频任务；复用已保存的 API 图和 prompt_id，不重新创建任务。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000, output,
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitJob(await resumeVideoJob(args.job_id, exec), exec?.signal)
    } }
}
