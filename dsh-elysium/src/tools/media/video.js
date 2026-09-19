// 职责：视频生成与原任务恢复的 Harness 工具定义；执行交给 worker 任务管理器。
import { VIDEO_MODES, retryTask, submitTask, waitJob } from '../../worker/index.js'
import { userRequestedRetry } from '../../session/index.js'
import { generationProjectId } from '../project/context.js'

const VIDEO_WORKFLOW_TIMEOUT_MS = 451 * 60 * 1000
const media = description => ({ type: 'string', description: `${description}，引用格式遵循当前后端的素材能力说明。` })

export function createCallToolsVideo() {
  return {
    name: 'call_tools_video',
    description: '视频创作统一入口：当前后端可同时提供标准模式与兼容的多镜头导演计划。两类参数互斥；失败或断网保留原任务，禁止改提示词或档位重新生成。',
    timeoutMs: VIDEO_WORKFLOW_TIMEOUT_MS + 60_000,
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {
      project_id: { type: 'string', description: '仅导演模式使用的项目 ID；自由模式省略。' },
      new_video: { type: 'boolean', description: '仅当用户明确要求另一个视频时设为 true；失败重试禁止设置。默认复用未完成任务。' },
      mode: { type: 'string', enum: VIDEO_MODES },
      duration_seconds: { type: 'number', exclusiveMinimum: 0, description: '请求时长（秒）；支持范围和默认值由当前后端能力说明决定，结果返回实际时长。' },
      prompt: { type: 'string' },
      first_frame: media('I2VA/FL2VA 首帧'),
      last_frame: media('FL2VA 尾帧'),
      reference_image_1: media('R2VA 第一张参考图'),
      reference_image_2: media('R2VA 第二张参考图'),
      duration: { type: 'integer', minimum: 1, description: 'main 导演计划总秒数；与 mode 参数分支互斥。' },
      prompts: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'main 兼容单镜头或顺序分镜提示词。' },
      image_path: media('main 兼容首帧图片'),
      image_prompt: { type: 'string', description: 'main 兼容：先生成首帧再进行单镜头视频生成。' },
      video_paths: { type: 'array', minItems: 1, items: media('main 兼容复用视频') },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
      shots: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['id', 'duration'], properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$' }, duration: { type: 'integer', minimum: 1 },
        mode: { type: 'string', enum: ['independent', 'continue', 'reference', 'reuse'] }, prompt: { type: 'string' },
        image_path: media('镜头图片'), image_role: { type: 'string', enum: ['character-sheet', 'single-view', 'scene'] },
        video_path: media('镜头视频'), audio_path: media('镜头音频'), seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
        in_point: { type: 'number', minimum: 0 },
      } } },
    }, oneOf: [{ required: ['mode', 'prompt'] }, { required: ['duration'] }] },
    execute: async ({ project_id, new_video = false, ...plan }, exec) => {
      const job = await submitTask('video', { ...plan, project_id: await generationProjectId(project_id, exec), new_task: new_video }, exec)
      return waitJob(job, exec?.signal)
    },
  }
}

export function createCallToolsVideoRecover() {
  return { name: 'call_tools_video_recover', description: '仅在用户要求重试时调用一次；失败后停止，等待用户，不得连续调用或改用生成工具。恢复原服务器的视频任务；复用已保存的 API 图和 prompt_id，不重新创建任务。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: VIDEO_WORKFLOW_TIMEOUT_MS + 60_000,
    execute: async (args, exec) => {
      const consent = userRequestedRetry(exec?.agent?.session?.snapshotEvents?.())
      return waitJob(await retryTask(args.job_id, { kind: 'video', exec, consent }), exec?.signal)
    } }
}
