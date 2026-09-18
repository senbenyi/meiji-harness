// 职责：提供角色正侧背视图和三视图拼接工具，并固定同一正面身份。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveGenerationBackend, validateBackendPlan, withBackend } from '../servers/runtime/index.js'
import { createJob } from '../business/jobs/create.js'
import { getJob } from '../business/jobs/query.js'
import { withLaunchLock } from '../business/jobs/lock.js'
import { readJson, saveJson } from '../business/jobs/store.js'
import { launch } from '../business/video/launcher.js'
import { bindVideoCall } from '../business/video/call-binding.js'
import { waitJob } from '../business/jobs/wait.js'
import { ModelTaskError } from '../business/jobs/errors.js'
import { runtimeRoot } from '../utils/storage-paths.js'
import { generationProjectId } from '../utils/project.js'
import { renderToolDebug } from '../utils/output.js'
import { mediaReference } from '../comfyui/media-reference.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
const directions = {
  front: 'Strict FRONT VIEW, head level, shoulders level, facing directly toward the camera.',
  side: 'Strict 90 degree SIDE PROFILE facing left, face and torso facing the same direction. Only one eye visible.',
  back: 'Strict 180 degree BACK VIEW, looking directly away. Show back of head, back of clothing, rear pockets and heels. No face, no eyes, no nose visible.',
}
const output = { schema: { type: 'object', additionalProperties: true, properties: { job_id: { type: 'string' }, status: { type: 'string' } }, required: ['job_id', 'status'] }, render: renderToolDebug }

async function imageJob(id) {
  const job = await getJob(id)
  if (job.status !== 'succeeded' || job.result?.media_kind !== 'image') throw invalid('必须使用已成功生成的图片任务')
  await withBackend(job.server, () => mediaReference(job.result.comfyui_view_url, ['.png', '.jpg', '.jpeg', '.webp']))
  if (!job.result.comfyui_artifact_id) throw invalid('参考任务缺少 ComfyUI 产物标识')
  return job
}

async function runImagePlan(projectId, plan, exec) {
  const backend = await resolveGenerationBackend('image')
  await validateBackendPlan(backend, plan)
  const jobId = await createJob(projectId, plan, backend)
  await bindVideoCall(jobId, exec)
  return waitJob(await launch(jobId, 'workflow-image'), exec?.signal)
}

export async function characterView(args, exec) {
  if (!Object.hasOwn(directions, args.view) || typeof args.description !== 'string' || !args.description.trim()) throw invalid('提供 front/side/back 和固定角色服装描述')
  if (args.retry !== undefined && typeof args.retry !== 'boolean') throw invalid('retry 必须为布尔值')
  const projectId = await generationProjectId(args.project_id, exec)
  if (args.view === 'front') {
    if (args.reference_job_id || args.retry) throw invalid('正面定妆不接受参考任务或视角重试参数')
    return runImagePlan(projectId, { capability: 'image-generate', params: { preset: 'standard', seed: 666,
      prompt: `ONE adult person, full body character reference photograph. ${directions.front} ${args.description.trim()}. Neutral symmetrical upright stance, straight legs, feet flat parallel shoulder-width apart, arms hanging straight down slightly away from torso. Entire head and shoes visible, plain light gray studio background, flat even lighting. Single person, no collage.`,
      character: { view: 'front', description: args.description.trim() } } }, exec)
  }
  const front = await imageJob(args.reference_job_id)
  if (front.project_id !== projectId) throw invalid('角色参考必须属于当前项目')
  if (front.result.character && front.result.character.view !== 'front') throw invalid('请使用最初确认的正面图')
  if (front.result.character?.description && front.result.character.description !== args.description.trim()) throw invalid('保持正面定妆时的原始角色描述')
  const directory = join(runtimeRoot(), 'characters', front.job_id)
  await mkdir(directory, { recursive: true })
  let created = false
  const id = await withLaunchLock(directory, async () => {
    const file = join(directory, 'character.json')
    const saved = await readJson(file) || { reference_job_id: front.job_id, reference_artifact_id: front.result.comfyui_artifact_id,
      description: args.description.trim(), views: { side: [], back: [] } }
    if (saved.description !== args.description.trim() || saved.reference_artifact_id !== front.result.comfyui_artifact_id) throw invalid('角色描述与已固定设定不一致')
    const attempts = saved.views[args.view]
    if (attempts.length) {
      const current = await getJob(attempts.at(-1))
      if (!args.retry || !['succeeded', 'failed'].includes(current.status)) return current.job_id
    }
    if (attempts.length >= 3) throw invalid('该视角已尝试三次，请人工检查，禁止继续循环生成')
    const plan = { capability: 'image-generate', params: { preset: 'standard', seed: 666 + attempts.length,
      image_path: front.result.path,
      prompt: `ONE adult person, full body character reference photograph. ${directions[args.view]} Same person and identical outfit as the reference image. ${saved.description}. Neutral upright stance, straight legs, parallel flat feet, arms down slightly away from torso. Head and shoes fully visible, plain light gray studio background, even lighting. Single person, single view, no collage.`,
      character: { reference_job_id: front.job_id, reference_artifact_id: front.result.comfyui_artifact_id, view: args.view, attempt: attempts.length + 1 } } }
    const backend = await resolveGenerationBackend('image')
    await validateBackendPlan(backend, plan)
    const jobId = await createJob(projectId, plan, backend)
    attempts.push(jobId)
    await saveJson(file, saved)
    created = true
    return jobId
  })
  await bindVideoCall(id, exec)
  if (created) return waitJob(await launch(id, 'workflow-image'), exec?.signal)
  const current = await getJob(id)
  if (current.status === 'failed' && !args.retry) throw new ModelTaskError(current.error_code || 'MODEL_GENERATION_FAILED', `原任务 ${id} 失败；明确要求重做后再 retry=true`, 409)
  return current.status === 'succeeded' ? current : waitJob(await launch(id, 'workflow-image', current.status === 'failed'), exec?.signal)
}

export async function characterSheet(args, exec) {
  const jobs = await Promise.all([args.reference_job_id, args.side_job_id, args.back_job_id].map(imageJob))
  const [front, side, back] = jobs
  const projectId = await generationProjectId(args.project_id, exec)
  if (jobs.some(job => job.project_id !== projectId)) throw invalid('三张角色图必须属于当前项目')
  for (const [job, view] of [[side, 'side'], [back, 'back']]) {
    const identity = job.result.character
    if (identity?.reference_job_id !== front.job_id || identity?.reference_artifact_id !== front.result.comfyui_artifact_id || identity?.view !== view) throw invalid('侧面和背面必须来自同一正面参考，且视角不能互换')
  }
  if (!Array.isArray(args.crops) || args.crops.length !== 3) throw invalid('依次提供正面、侧面、背面的完整人物边界')
  return runImagePlan(projectId, { capability: 'image-compose', params: {
    views: jobs.map((job, index) => ({ path: job.result.path, crop: args.crops[index] })),
    character: { reference_job_id: front.job_id, reference_artifact_id: front.result.comfyui_artifact_id,
      view: 'sheet', source_jobs: jobs.map(job => job.job_id) },
  } }, exec)
}

export function createCharacterTools() {
  const id = { type: 'string', pattern: '^[a-f0-9]{32}$' }
  const project = { type: 'string', pattern: '^[a-f0-9]{8}$' }
  return [{ name: 'model_character_view', description: '生成固定角色的正面、侧面或背面视图；先确认 front，再以同一正面任务生成 side/back，每视角最多三次。', timeoutMs: 121 * 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: { project_id: project, reference_job_id: id,
      description: { type: 'string' }, view: { type: 'string', enum: ['front', 'side', 'back'] }, retry: { type: 'boolean' } }, required: ['description', 'view'] },
    output, execute: characterView },
  { name: 'model_character_sheet', description: '把同一角色已确认的正面、侧面和背面按像素边界拼成三视图，不重新生成角色。', timeoutMs: 121 * 60_000,
    parameters: { type: 'object', additionalProperties: false, properties: { project_id: project, reference_job_id: id, side_job_id: id, back_job_id: id,
      crops: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false,
        properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'integer', minimum: ['x', 'y'].includes(key) ? 0 : 1 }])), required: ['x', 'y', 'width', 'height'] } },
    }, required: ['reference_job_id', 'side_job_id', 'back_job_id', 'crops'] }, output, execute: characterSheet }]
}
