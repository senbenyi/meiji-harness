// 职责：组合项目持久化、任务提交与媒体可用性校验，供路由、流水线和 Harness 工具使用。
import { createProjectStore as createStore, episodeReviewIssue } from '../../database/managers/projects.js'
import { completeStructured, getJob, registerSink, removeProjectTasks, retry, submit, taskId } from '../../worker/index.js'
import { availableJobSummary } from '../media/catalog.js'
import { validEpisode, validJobId, validProjectId, validShotId } from './schema.js'
import { statusError } from '../../utils/errors.js'
import { createPlanningService } from './planning.js'
import { createHash } from 'node:crypto'

export { projectSummary } from '../../database/managers/projects.js'
const invalidRequest = message => statusError(400, message)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const seedOf = (submissionId, index) => parseInt(digest([submissionId, index]).slice(0, 8), 16)
const lane = projectId => ({ id: `project-${projectId}-main`, priority: 'batch' })
const running = shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && Boolean(shot.job_id)

// 每镜两个任务同泳道按序执行：先按首帧提示词与主角锚点图出首帧，再以首帧图生视频。
function shotTasks(project, shot, episode, submissionId) {
  if (!shot.prompt_finalized || !shot.prompt.trim() || !shot.keyframe_prompt.trim()) throw statusError(409, `镜头 ${shot.id} 的提示词尚未定稿`)
  const anchor = shot.roles.length ? project.anchors.find(item => item.role === shot.roles[0]) : null
  if (shot.roles.length && (!validJobId(anchor?.source?.job_id) || anchor.image_needs_review)) throw statusError(409, `镜头 ${shot.id} 的主角锚点图尚未就绪`)
  const scene = project.anchors.find(item => item.role === `scene-${shot.scene}`)
  return [
    { kind: 'image', plan: { capability: 'image-generate', params: { prompt: shot.keyframe_prompt, seed: seedOf(submissionId, 0), purpose: 'keyframe',
      ...(anchor ? { image_path: `job:${anchor.source.job_id}` } : {}) } }, binding: { type: 'keyframe', shot_id: shot.id, episode } },
    { kind: 'video', plan: { mode: 'i2va', prompt: `${scene ? `场景：${scene.label}。${scene.description}\n` : ''}${shot.prompt}`,
      first_frame: `job:${taskId(submissionId, 0)}`, duration_seconds: shot.duration, seed: seedOf(submissionId, 1) }, binding: { type: 'shot', shot_id: shot.id, episode } },
  ]
}

export function createProjectStore(options = {}) {
  const { submitTasks = submit, retryTask = retry, complete = completeStructured, ...storeOptions } = options
  const store = createStore({ readJob: getJob, summarizeJob: availableJobSummary, removeTasks: removeProjectTasks, ...storeOptions })
  const shotOf = async (projectId, episode, shotId) => {
    if (!validProjectId(projectId) || !validEpisode(episode) || !validShotId(shotId)) throw invalidRequest('项目、集数或镜头无效')
    const project = await store.readEpisode(projectId, episode), shot = project.acts.flatMap(act => act.shots).find(item => item.id === shotId)
    if (!shot) throw invalidRequest('镜头不存在')
    return { project, shot }
  }

  // 按剧情总览同步角色与场景锚点；返回需要重新出图的角色，是否需要重新确认由调用方决定。
  store.createAnchorsFromCast = async (id, series) => {
    let project = await store.read(id)
    const current = new Set(), changed = []
    for (const item of series.characters) {
      current.add(item.id)
      const description = `${item.appearance}；音色：${item.voice}；性格：${item.personality}`
      const previous = project.anchors.find(anchor => anchor.role === item.id)
      if (!previous) {
        project = await store.changeAnchor(id, 'add', { role: item.id, kind: 'character', label: item.name, description, image_prompt: item.image_prompt })
        changed.push(item.id)
      } else if (previous.label !== item.name || previous.description !== description || previous.image_prompt !== item.image_prompt || previous.retired) {
        const redraw = previous.image_prompt !== item.image_prompt || previous.retired || false
        project = await store.changeAnchor(id, 'update', { role: item.id, label: item.name, description, image_prompt: item.image_prompt, retired: false,
          image_needs_review: redraw || previous.image_needs_review || false })
        if (redraw) changed.push(item.id)
      }
    }
    for (const item of series.scenes) {
      const role = `scene-${item.id}`
      current.add(role)
      const previous = project.anchors.find(anchor => anchor.role === role)
      if (!previous) project = await store.changeAnchor(id, 'add', { role, kind: 'scene', label: item.name, description: item.description })
      else if (previous.label !== item.name || previous.description !== item.description || previous.retired) {
        project = await store.changeAnchor(id, 'update', { role, label: item.name, description: item.description, retired: false })
      }
    }
    for (const anchor of project.anchors) if (!current.has(anchor.role) && !anchor.retired) project = await store.changeAnchor(id, 'update', { role: anchor.role, retired: true })
    return { project, changed }
  }

  store.generateAnchorImage = async ({ project_id: projectId, role }) => {
    if (!validProjectId(projectId) || typeof role !== 'string') throw invalidRequest('项目或锚点无效')
    const project = await store.read(projectId), anchor = project.anchors.find(item => item.role === role)
    if (!anchor || anchor.retired || anchor.kind !== 'character') throw invalidRequest('只能为有效的角色锚点出图')
    if (anchor.image_job_id && ['pending', 'queued', 'running'].includes((await getJob(anchor.image_job_id)).status)) return project
    const submissionId = `anchor-${digest([projectId, role, anchor.image_prompt, Date.now()]).slice(0, 32)}`
    const receipt = await submitTasks({ submission_id: submissionId, lane: lane(projectId), project_id: projectId, channel: 'project',
      tasks: [{ kind: 'image', plan: { capability: 'image-generate', params: { prompt: anchor.image_prompt, seed: seedOf(submissionId, 0), character: { view: 'front' } } },
        binding: { type: 'anchor', role } }] })
    return store.changeAnchor(projectId, 'update', { role, image_job_id: receipt.tasks[0].task_id })
  }

  // 为缺图或需复核的角色锚点出图，已在出图中的跳过。
  store.generateAnchorImages = async projectId => {
    const project = await store.read(projectId)
    for (const anchor of project.anchors) if (anchor.kind === 'character' && !anchor.retired && (!anchor.source || anchor.image_needs_review)) {
      await store.generateAnchorImage({ project_id: projectId, role: anchor.role })
    }
    return store.read(projectId)
  }

  store.planning = createPlanningService(store, complete)

  // 提交一镜；同一 take 重复调用得到同一批任务，重启后不会重复生成。
  store.produceShot = async ({ project_id: projectId, episode, shot_id: shotId }) => {
    const { project, shot } = await shotOf(projectId, episode, shotId)
    if (shot.job_id) throw statusError(409, `镜头 ${shotId} 已有任务，请先重拍`)
    const issue = episodeReviewIssue(project, await store.readPlanning(projectId), episode, [shot])
    if (issue) throw statusError(409, issue)
    const submissionId = `shot-${digest([projectId, episode, shotId, shot.take]).slice(0, 32)}`
    const receipt = await submitTasks({ submission_id: submissionId, lane: lane(projectId), project_id: projectId, channel: 'project',
      tasks: shotTasks(project, shot, episode, submissionId) })
    return store.changeShot(projectId, { id: shotId, episode, take: shot.take + 1, keyframe_job_id: receipt.tasks[0].task_id,
      job_id: receipt.tasks[1].task_id, status: 'pending' })
  }

  // 重拍：解除当前任务，交给流水线用新 take（新种子）重新提交；旧素材仍保留在素材库。
  store.reshootShot = async ({ project_id: projectId, episode, shot_id: shotId }) => {
    const { shot } = await shotOf(projectId, episode, shotId)
    if (running(shot)) throw statusError(409, '镜头正在生成，完成后再重拍')
    await store.changeAuto(projectId, auto => { delete auto.attempts[`${episode}/${shotId}`]; return auto })
    return store.changeShot(projectId, { id: shotId, episode, job_id: null, keyframe_job_id: null, status: 'pending' })
  }

  // 恢复：仅用于首帧已成功、视频因基础设施失败的原任务。
  store.retryShot = async ({ project_id: projectId, episode, shot_id: shotId }) => {
    const { shot } = await shotOf(projectId, episode, shotId)
    if (shot.status !== 'failed' || !shot.job_id || (await getJob(shot.keyframe_job_id)).status !== 'succeeded') throw statusError(409, '只有首帧已完成、视频失败的镜头可以恢复，其余请重拍')
    const job = await retryTask(shot.job_id, { kind: 'video', consent: true })
    return store.changeShot(projectId, { id: shotId, episode, expect_job_id: shot.job_id, status: job.status })
  }

  // 自动生产开关：继续时清空本轮重试计数；因上游变更暂停后继续即确认级联。
  const planned = async id => {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    const planning = await store.readPlanning(id)
    const series = planning.series.versions.find(item => item.version === planning.series.finalized)?.value
    if (!series || planning.series.needs_review) throw statusError(409, '请先定稿剧情总览')
    return series
  }
  store.startAuto = async ({ id, until_episode: until = null }) => {
    const series = await planned(id)
    if (until !== null && (!validEpisode(until) || until > series.episode_count)) throw invalidRequest('生产范围无效')
    return store.changeAuto(id, auto => ({ ...auto, enabled: true, until_episode: until, paused: null, attempts: {} }))
  }
  store.pauseAuto = ({ id }) => store.changeAuto(id, auto => ({ ...auto, enabled: false }))
  store.resumeAuto = async ({ id }) => {
    await planned(id)
    return store.changeAuto(id, auto => ({ ...auto, enabled: true, paused: null, attempts: {},
      cascade_confirmed: auto.cascade_confirmed || auto.paused?.step === 'cascade' }))
  }
  store.confirmAnchors = async ({ id }) => {
    const project = await store.read(id)
    const missing = project.anchors.find(anchor => anchor.kind === 'character' && !anchor.retired && (!anchor.source || anchor.image_needs_review))
    if (missing) throw statusError(409, `角色「${missing.label}」参考图尚未就绪`)
    return store.changeAuto(id, auto => ({ ...auto, anchors_confirmed: true }))
  }
  return store
}

// 项目只解释自己的 binding；任务引擎仅负责至少投递一次。
export function registerProjectSinks(ctx, store) {
  const register = (type, handler) => ctx.effect(() => registerSink(type, handler), `elysium project ${type} sink`)
  register('shot', (job, task) => store.changeShot(task.project_id, { id: task.binding.shot_id, episode: task.binding.episode, expect_job_id: job.job_id, status: job.status }))
  register('keyframe', (job, task) => job.status === 'succeeded' ? null
    : store.changeShot(task.project_id, { id: task.binding.shot_id, episode: task.binding.episode, expect_keyframe_job_id: job.job_id, status: 'failed' }))
  register('anchor', async (job, task) => {
    const anchor = (await store.read(task.project_id)).anchors.find(item => item.role === task.binding.role)
    if (anchor?.image_job_id !== job.job_id || job.status !== 'succeeded') return
    return store.changeAnchor(task.project_id, 'update', { role: task.binding.role, source: { type: 'job', job_id: job.job_id }, image_needs_review: false })
  })
}
