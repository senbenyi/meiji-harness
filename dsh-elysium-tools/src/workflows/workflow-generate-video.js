import { startVideoJob, resumeVideoJob } from './video-jobs.js'
import { renderToolDebug } from '../functions/common/tool.js'
import { MODEL_TIMEOUTS } from '../jobs/contracts.js'
import { waitJob } from '../jobs/wait.js'

export { waitJob as waitVideoJob } from '../jobs/wait.js'

const output = { schema: { type: 'object', properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }

export function createWorkflowGenerateVideoTool() {
  return {
    name: 'workflow_generate_video',
    description: '视频生产唯一入口：已有分镜文件仅传 plan_path，插件原样读取，不要让模型重抄长 JSON。否则多镜头用 shots 保留各镜时长、完整提示词和真实参考素材。自动选择导演工作流，等待完成并返回成片；校验失败不得缩短时长或删减分镜。',
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: {
      plan_path: { type: 'string', description: '单独使用：artifacts 内本地 JSON 绝对路径，或 ssh://服务器别名/共享目录/分镜.json（需本机 SSH 可访问）。文件内容为完整 duration/shots 请求，素材位于同目录或子目录。不要同时传 duration/shots 或其他字段。' },
      duration: { type: 'integer', minimum: 1, description: '目标总秒数，最终按实际文件验收。' },
      shots: { type: 'array', minItems: 1, description: '优先用于多镜头；总时长等于各镜 duration 之和，可少于或等于15秒。不能与旧 prompts/image_path/image_prompt/video_paths 混用。', items: {
        type: 'object', additionalProperties: false, required: ['id', 'duration'], properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$', description: '唯一镜号，返回素材与进度按此关联。' },
          duration: { type: 'integer', minimum: 1, description: '本镜目标秒数；生成镜头最多15秒。' },
          mode: { type: 'string', enum: ['independent', 'continue', 'reference', 'reuse'], description: '默认independent：文生或起始图；continue：续接前镜末帧；reference：图片/视频/音频参考；reuse：复用已有视频。切镜用independent或reference。' },
          prompt: { type: 'string', description: '生成时完整保留角色、服装、构图、动作与声音要求；reuse不接受。' },
          image_path: { type: 'string', description: '真实角色/场景图片；independent中作为首帧，reference中作为参考。' },
          video_path: { type: 'string', description: 'reference的视频参考，或reuse要选用的已有镜头。' },
          audio_path: { type: 'string', description: '仅reference接受，声音参考不等于口型保证。' },
          seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
          in_point: { type: 'number', minimum: 0, description: '仅reuse：剪辑起点秒数，默认0；选取后续duration秒。' },
        },
      } },
      prompts: { type: 'array', minItems: 1, items: { type: 'string' }, description: '新生成时按顺序填写；不超过15秒一条，长视频至少两条，每段1..15秒。' },
      image_path: { type: 'string', description: '可选已有首帧绝对路径。长视频须提供它或 image_prompt。' },
      image_prompt: { type: 'string', description: '可选首帧生成提示词，与 image_path 二选一。' },
      video_paths: { type: 'array', minItems: 1, items: { type: 'string' }, description: '已有 MP4 按镜头顺序复用；不能与生成输入混用，不重新生成。' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: '默认666。' },
    }, anyOf: [{ required: ['duration'] }, { required: ['plan_path'] }] }, output,
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitJob(await startVideoJob(args, exec), exec?.signal)
    },
  }
}

export function createWorkflowResumeVideoTool() {
  return { name: 'workflow_resume_video', description: '恢复原视频工作流，复用有效步骤，保留原输入和任务 ID；先查询失败原因。已成功或正在执行的任务不重复启动。',
    parameters: { type: 'object', additionalProperties: false, properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    timeoutMs: MODEL_TIMEOUTS.workflow + 60_000,
    output, execute: async (args, exec) => {
      exec?.signal?.throwIfAborted()
      return waitJob(await resumeVideoJob(args.job_id, exec), exec?.signal)
    } }
}
