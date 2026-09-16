// 职责：把视频生成与恢复服务适配为 Harness 工具。
import { startVideoJob, resumeVideoJob } from '../business/video/service.js'
import { VIDEO_MODES, VIDEO_PROFILES } from '../business/video/plan.js'
import { renderToolDebug } from './output.js'
import { waitJob } from '../business/jobs/wait.js'
import { createTiming } from '../business/jobs/timing.js'
import { generationProjectId } from './generation-project.js'
import { ModelTaskError } from '../business/jobs/errors.js'

export { waitJob as waitVideoJob } from '../business/jobs/wait.js'

const VIDEO_WORKFLOW_TIMEOUT_MS = 451 * 60 * 1000
const output = { schema: { type: 'object', properties: { project_id: { type: 'string' }, job_id: { type: 'string' }, status: { type: 'string' } }, required: ['project_id', 'job_id', 'status'] }, render: renderToolDebug }
const media = description => ({ type: 'string', description: `${description}，引用格式遵循当前后端的素材能力说明。` })

export function userRequestedVideoRetry(exec) {
  const events = exec?.agent?.session?.snapshotEvents?.() || []
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  const text = events.slice(turnStart + 1).filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')
    .flatMap(event => event.data.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
  if (/(不要|不许|禁止|无需|别)\s*(自动)?\s*(重试|恢复|继续)/i.test(text)) return false
  return /(重试|恢复|继续|\bretry\b|\bresume\b|\bcontinue\b)/i.test(text)
}

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '视频创作统一入口：preview 预览创作、regular 常规创作、high-quality 高清创作。失败或断网保留原任务，禁止改提示词或档位重新生成；自动重试耗尽后等待用户要求恢复。standard 是原工作流兼容参数，不是常规创作。',
    timeoutMs: VIDEO_WORKFLOW_TIMEOUT_MS + 60_000,
    parameters: { type: 'object', additionalProperties: false, required: ['mode', 'prompt'], properties: {
      project_id: { type: 'string', description: '教学和导演模式的项目 ID；自由模式省略。' },
      new_video: { type: 'boolean', description: '仅当用户明确要求另一个视频时设为 true；失败重试禁止设置。默认复用未完成任务。' },
      mode: { type: 'string', enum: VIDEO_MODES },
      profile: { type: 'string', enum: VIDEO_PROFILES, description: '创作档次；具体规格和支持模式由当前后端能力说明决定。' },
      duration_seconds: { type: 'number', exclusiveMinimum: 0, description: '请求时长（秒）；支持范围和默认值由当前后端能力说明决定，结果返回实际时长。' },
      preview_variant: { type: 'string', enum: ['default', 'low-resolution'], description: '预览变体；仅在当前后端支持且用户明确选择时使用。' },
      prompt: { type: 'string' },
      first_frame: media('I2VA/FL2VA 首帧'),
      last_frame: media('FL2VA 尾帧'),
      reference_image_1: media('R2VA 第一张参考图'),
      reference_image_2: media('R2VA 第二张参考图'),
    } }, output,
    execute: async (args, exec) => {
      const timing = createTiming()
      exec?.signal?.throwIfAborted()
      const projectId = await generationProjectId(args.project_id, exec)
      const job = await timing.measure('job.start', () => startVideoJob({ ...args, project_id: projectId }, exec))
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
      if (!userRequestedVideoRetry(exec)) throw new ModelTaskError('MODEL_RETRY_CONFIRMATION_REQUIRED', '等待用户明确要求重试后才能恢复原视频任务', 409)
      const timing = createTiming()
      exec?.signal?.throwIfAborted()
      const job = await timing.measure('job.resume', () => resumeVideoJob(args.job_id, exec))
      const result = await timing.measure('job.wait', () => waitJob(job, exec?.signal, undefined, undefined, timing))
      return { ...result, tool_timings: timing.snapshot() }
    } }
}
