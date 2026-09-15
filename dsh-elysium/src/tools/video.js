// 职责：把视频生成与恢复服务适配为 Harness 工具。
import { startVideoJob, resumeVideoJob } from '../business/video/service.js'
import { VIDEO_MODES, VIDEO_PROFILES } from '../business/video/plan.js'
import { renderToolDebug } from './output.js'
import { waitJob } from '../business/jobs/wait.js'
import { createTiming } from '../business/jobs/timing.js'

export { waitJob as waitVideoJob } from '../business/jobs/wait.js'

const VIDEO_WORKFLOW_TIMEOUT_MS = 451 * 60 * 1000
const output = { schema: { type: 'object', properties: { project_id: { type: 'string' }, job_id: { type: 'string' }, status: { type: 'string' } }, required: ['project_id', 'job_id', 'status'] }, render: renderToolDebug }
const media = description => ({ type: 'string', description: `${description}，必须是当前服务器的 ComfyUI /view URL。` })

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '视频创作统一入口：preview 预览创作、regular 常规创作、high-quality 高清创作。失败或断网保留原任务，禁止改提示词或档位重新生成；自动重试耗尽后等待用户要求恢复。standard 是原工作流兼容参数，不是常规创作。',
    timeoutMs: VIDEO_WORKFLOW_TIMEOUT_MS + 60_000,
    parameters: { type: 'object', additionalProperties: false, required: ['project_id', 'mode', 'prompt'], properties: {
      project_id: { type: 'string', description: '任务所属项目 ID。' },
      new_video: { type: 'boolean', description: '仅当用户明确要求另一个视频时设为 true；失败重试禁止设置。默认复用未完成任务。' },
      mode: { type: 'string', enum: VIDEO_MODES },
      profile: { type: 'string', enum: VIDEO_PROFILES, description: '必须显式选择：preview=384×512约3秒；regular=576×768单次生成，默认5秒，时长遵循H3节点范围，可传duration_seconds，二者8步24fps无插帧且仅支持t2va/i2va；high-quality=原生规格五模式，保留各自采样和RIFE。省略或standard兼容原工作流。高清不表示新增超分。' },
      duration_seconds: { type: 'number', exclusiveMinimum: 0, description: '仅用于 regular，单次生成的请求时长（秒），默认5秒；按当前H3节点的帧数上下限校验，不额外硬卡15秒，不自动拆分拼接。训练范围约5–15秒，更长未测试，不主动延长。按H3帧数对齐，15秒请求实际约15.08秒，结果返回实际时长。' },
      preview_variant: { type: 'string', enum: ['default', 'low-resolution'], description: '仅用于 preview。省略或 default 保持已验证的 384×512；仅在用户明确选择低分辨率候选时使用 low-resolution（288×384），仍为 73 帧、24fps、8 步。' },
      prompt: { type: 'string' },
      first_frame: media('I2VA/FL2VA 首帧'),
      last_frame: media('FL2VA 尾帧'),
      reference_image_1: media('R2VA 第一张参考图'),
      reference_image_2: media('R2VA 第二张参考图'),
    } }, output,
    execute: async (args, exec) => {
      const timing = createTiming()
      exec?.signal?.throwIfAborted()
      const job = await timing.measure('job.start', () => startVideoJob(args, exec))
      const result = await timing.measure('job.wait', () => waitJob(job, exec?.signal, undefined, undefined, timing))
      return { ...result, tool_timings: timing.snapshot() }
    },
  }
}

export function createWorkflowResumeVideoTool() {
  return { name: 'workflow_resume_video', description: '仅在用户要求重试时调用一次；失败后停止，等待用户，不得连续调用或改用生成工具。恢复原服务器的视频任务；复用已保存的 API 图和 prompt_id，不重新创建任务。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: VIDEO_WORKFLOW_TIMEOUT_MS + 60_000, output,
    execute: async (args, exec) => {
      const timing = createTiming()
      exec?.signal?.throwIfAborted()
      const job = await timing.measure('job.resume', () => resumeVideoJob(args.job_id, exec))
      const result = await timing.measure('job.wait', () => waitJob(job, exec?.signal, undefined, undefined, timing))
      return { ...result, tool_timings: timing.snapshot() }
    } }
}
