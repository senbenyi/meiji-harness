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
    description: '失败或断网时保留原任务，不得通过改提示词重新生成。自动重试耗尽后停止调用，等待用户要求恢复。standard 保留原工作流；preview 用于低分辨率短镜头快速预览，仅支持 t2va、i2va，返回实际规格。',
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    parameters: { type: 'object', additionalProperties: false, required: ['mode', 'prompt'], properties: {
      new_video: { type: 'boolean', description: '仅当用户明确要求另一个视频时设为 true；失败重试禁止设置。默认复用未完成任务。' },
      mode: { type: 'string', enum: VIDEO_MODES },
      profile: { type: 'string', enum: ['standard', 'preview'], description: '默认 standard；短剧草稿选择 preview，约 3 秒、384×512，不插帧。' },
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
  return { name: 'workflow_resume_video', description: '仅在用户要求重试时调用一次；失败后停止，等待用户，不得连续调用或改用生成工具。恢复原 RunPod 视频任务；复用已保存的 API 图和 prompt_id，不重新创建任务。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000, output,
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitJob(await resumeVideoJob(args.job_id, exec), exec?.signal)
    } }
}
