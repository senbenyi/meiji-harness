import { startVideoJob, resumeVideoJob } from './video-jobs.js'
import { renderToolDebug } from '../functions/common/tool.js'
import { getJob, completedResult, MODEL_TIMEOUTS } from '../functions/common/task.js'
import { setTimeout } from 'node:timers/promises'

export async function waitVideoJob(job, signal, read = getJob, pause = setTimeout) {
  try {
    for (;;) {
      signal?.throwIfAborted()
      const current = await read(job.job_id)
      if (current.status === 'succeeded') return completedResult(current)
      if (current.status === 'failed') return current
      await pause(2000, undefined, { signal })
    }
  } catch (error) {
    throw new Error(`等待任务中断；job_id: ${job.job_id}；用 model_job_status 查询原任务，勿重新生成。${error.message}`, { cause: error })
  }
}

const output = { schema: { type: 'object', properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '视频生产唯一入口：生成或合片，程序等待完成并返回成片与验证结果，无需轮询。中断后按原 job_id 查询。保留原音轨和规格。',
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: {
      duration: { type: 'integer', minimum: 1, description: '目标总秒数，最终按实际文件验收。' },
      prompts: { type: 'array', minItems: 1, items: { type: 'string' }, description: '新生成时按顺序填写；不超过15秒一条，长视频至少两条，每段1..15秒。' },
      image_path: { type: 'string', description: '可选已有首帧绝对路径。长视频须提供它或 image_prompt。' },
      image_prompt: { type: 'string', description: '可选首帧生成提示词，与 image_path 二选一。' },
      video_paths: { type: 'array', minItems: 1, items: { type: 'string' }, description: '已有 MP4 按镜头顺序复用；不能与生成输入混用，不重新生成。' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: '默认666。' },
    }, required: ['duration'] }, output,
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitVideoJob(await startVideoJob(args, exec), exec?.signal)
    },
  }
}

export function createWorkflowResumeVideoTool() {
  return { name: 'workflow_resume_video', description: '恢复原视频工作流，复用有效步骤，保留原输入和任务 ID；先查询失败原因。已成功或正在执行的任务不重复启动。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    output, execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitVideoJob(await resumeVideoJob(args.job_id, exec), exec?.signal)
    } }
}
