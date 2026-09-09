import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { getJob } from '../jobs/query.js'
import { readJson, saveJson } from '../jobs/json.js'
import { createJob } from '../jobs/create.js'
import { withLaunchLock } from '../jobs/launch.js'
import { resumeMediaJob, runMediaJob } from './media-jobs.js'
import { validateMediaPlan } from './media-plan.js'
import { sha256File } from '../functions/common/file-hash.js'
import { ModelTaskError } from '../jobs/contracts.js'
import { completedModelTool } from '../functions/common/tool.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
const directions = {
  front: 'Strict FRONT VIEW, head level, shoulders level, facing directly toward the camera.',
  side: 'Strict 90 degree SIDE PROFILE facing left, face and torso facing the same direction. Only one eye visible.',
  back: 'Strict 180 degree BACK VIEW, looking directly away. Show back of head, back of clothing, rear pockets and heels. No face, no eyes, no nose visible.',
}

async function imageJob(id) {
  const job = await getJob(id)
  if (job.status !== 'succeeded' || job.result?.media_kind !== 'image') throw invalid('必须使用已成功生成的图片任务')
  if (await sha256File(job.result.path) !== job.result.sha256) throw invalid('参考图片已被修改，请重新确认角色')
  return job
}

export async function characterView(args, exec) {
  if (!Object.hasOwn(directions, args.view) || typeof args.description !== 'string' || !args.description.trim()) throw invalid('提供 front/side/back 和固定角色服装描述')
  if (args.retry !== undefined && typeof args.retry !== 'boolean') throw invalid('retry 必须为布尔值')
  if (args.view === 'front') {
    if (args.reference_job_id || args.retry) throw invalid('正面定妆不接受参考任务或视角重试参数')
    return runMediaJob('image-generate', { preset: 'standard', seed: 666,
      prompt: `ONE adult person, full body character reference photograph. ${directions.front} ${args.description.trim()}. Neutral symmetrical upright stance, straight legs, feet flat parallel shoulder-width apart, arms hanging straight down slightly away from torso. Entire head and shoes visible, plain light gray studio background, flat even lighting. Single person, no collage.`,
      character: { view: 'front', description: args.description.trim() } }, exec)
  }
  const front = await imageJob(args.reference_job_id)
  if (front.result.character && front.result.character.view !== 'front') throw invalid('请使用最初确认的正面图，不要把衍生视图作为新的角色参考')
  if (front.result.character?.description && front.result.character.description !== args.description.trim()) throw invalid('保持正面定妆时的原始角色描述')
  const directory = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'characters', front.job_id)
  await mkdir(directory, { recursive: true })
  const id = await withLaunchLock(directory, async () => {
    const file = join(directory, 'character.json')
    const saved = await readJson(file) || { reference_job_id: front.job_id, reference_sha256: front.result.sha256,
      description: args.description.trim(), views: { side: [], back: [] } }
    if (saved.description !== args.description.trim() || saved.reference_sha256 !== front.result.sha256) throw invalid('角色描述与已固定设定不一致；保持原描述和正面参考')
    const attempts = saved.views[args.view]
    if (attempts.length) {
      const current = await getJob(attempts.at(-1))
      if (!args.retry || !['succeeded', 'failed'].includes(current.status)) return current.job_id
    }
    if (attempts.length >= 3) throw invalid('该视角已尝试三次，请人工检查能力或调整方案，禁止继续循环生成')
    const plan = { capability: 'image-generate', params: { preset: 'standard', seed: 666 + attempts.length,
      image_path: front.result.path,
      prompt: `ONE adult person, full body character reference photograph. ${directions[args.view]} Same person and identical outfit as the reference image. ${saved.description}. Neutral upright stance, straight legs, parallel flat feet, arms down slightly away from torso. Head and shoes fully visible, plain light gray studio background, even lighting. Single person, single view, no collage.`,
      character: { reference_job_id: front.job_id, reference_sha256: front.result.sha256, view: args.view, attempt: attempts.length + 1 } } }
    await validateMediaPlan(plan)
    const jobId = await createJob(plan, exec)
    // Persist the identity before launching: a lost response must not generate another view.
    attempts.push(jobId)
    await saveJson(join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', jobId, 'status.json'),
      { job_id: jobId, capability: 'workflow-media', backend: 'comfyui', status: 'queued', stage: 'queued' })
    await saveJson(file, saved)
    return jobId
  })
  const current = await getJob(id)
  if (current.status === 'failed') throw new ModelTaskError(current.error_code || 'MODEL_GENERATION_FAILED', `原任务 ${id} 失败：${current.error}；先检查原任务，不自动重新推理`, 409)
  const result = await resumeMediaJob(id, exec)
  if (result.status === 'failed') throw new ModelTaskError(result.error_code || 'MODEL_GENERATION_FAILED', `原任务 ${id} 失败：${result.error}；先检查原任务，不自动重新推理`, 409)
  return result
}

export async function characterSheet(args, exec) {
  const jobs = await Promise.all([args.reference_job_id, args.side_job_id, args.back_job_id].map(imageJob))
  const [front, side, back] = jobs
  for (const [job, view] of [[side, 'side'], [back, 'back']]) {
    const identity = job.result.character
    if (identity?.reference_job_id !== front.job_id || identity?.reference_sha256 !== front.result.sha256 || identity?.view !== view) throw invalid('侧面和背面必须来自同一正面参考，且视角不能互换')
  }
  if (!Array.isArray(args.crops) || args.crops.length !== 3) throw invalid('依次提供正面、侧面、背面的完整人物边界')
  return runMediaJob('image-compose', { views: jobs.map((job, index) => ({ path: job.result.path, crop: args.crops[index] })),
    character: { reference_job_id: front.job_id, reference_sha256: front.result.sha256, view: 'sheet',
      source_jobs: jobs.map(job => job.job_id) } }, exec)
}

export function createCharacterTools() {
  const id = { type: 'string', pattern: '^[a-f0-9]{32}$' }
  return [completedModelTool({ name: 'model_character_view',
    description: '角色三视图：先生成 front，用户确认后绑定 reference_job_id 生成一个 side/back。description 只写固定外观服装，每次保持完全一致。side/back 默认复用原任务；仅用户要求重做时 retry=true，每视角最多三次。不代表视觉验收通过。',
    timeoutMs: 41 * 60_000, parameters: { properties: { reference_job_id: id, description: { type: 'string' },
      view: { type: 'string', enum: ['front', 'side', 'back'] }, retry: { type: 'boolean' } }, required: ['description', 'view'] },
    execute: (args, _signal, exec) => characterView(args, exec) }),
  completedModelTool({ name: 'model_character_sheet',
    description: '只拼接已确认的正面、侧面、背面，不生成新人物。先看图确认方向、服装、完整全身；不能看图时请用户确认。crops 是各图中从头顶到鞋底、含全部手臂的像素边界，用于等比例对齐。未通过检查不得拼接交付。',
    timeoutMs: 10 * 60_000, parameters: { properties: { reference_job_id: id, side_job_id: id, back_job_id: id,
      crops: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false,
        properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'integer', minimum: ['x', 'y'].includes(key) ? 0 : 1 }])), required: ['x', 'y', 'width', 'height'] } } },
      required: ['reference_job_id', 'side_job_id', 'back_job_id', 'crops'] }, execute: (args, _signal, exec) => characterSheet(args, exec) })]
}
