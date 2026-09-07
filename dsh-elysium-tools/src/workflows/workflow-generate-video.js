import { startVideoJob, resumeVideoJob } from './video-jobs.js'
import { renderToolDebug } from '../functions/common/tool.js'

const output = { schema: { type: 'object', properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '视频生产唯一入口：生成短片或连续长片，或复用已有片段合片。后台执行并返回任务 ID；用 model_job_status/model_job_result 查询，成片验证通过才成功。保留原音轨和规格，不自动补帧、超分或追加声音。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      duration: { type: 'integer', minimum: 1, description: '目标总秒数，最终按实际文件验收。' },
      prompts: { type: 'array', minItems: 1, items: { type: 'string' }, description: '新生成时按顺序填写；不超过15秒一条，长视频至少两条，每段1..15秒。' },
      image_path: { type: 'string', description: '可选已有首帧绝对路径。长视频须提供它或 image_prompt。' },
      image_prompt: { type: 'string', description: '可选首帧生成提示词，与 image_path 二选一。' },
      video_paths: { type: 'array', minItems: 1, items: { type: 'string' }, description: '已有 MP4 按镜头顺序复用；不能与生成输入混用，不重新生成。' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: '默认666。' },
    }, required: ['duration'] }, output,
    execute: args => startVideoJob(args),
  }
}

export function createWorkflowResumeVideoTool() {
  return { name: 'workflow_resume_video', description: '恢复原视频工作流，复用有效步骤，保留原输入和任务 ID；先查询失败原因。已成功或正在执行的任务不重复启动。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    output, execute: args => resumeVideoJob(args.job_id) }
}
