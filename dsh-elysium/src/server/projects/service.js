// 职责：组合项目持久化、任务查询与媒体可用性校验，供路由和 Harness 工具使用。
import { createProjectStore as createStore } from '../../database/managers/projects.js'
import { completeStructured, getJob, registerSink, removeProjectTasks, retry, submit, taskId } from '../../worker/index.js'
import { availableJobSummary } from '../media/catalog.js'
import { serverUrl, validJobId, validProjectId, validShotId } from './schema.js'
import { statusError } from '../../utils/errors.js'
import { createPlanningService } from './planning.js'
import { generateStoryboard } from './storyboard.js'
import { composeFilm, composeEpisodeFilm } from './film.js'

export { projectSummary } from '../../database/managers/projects.js'
const invalidRequest = message => statusError(400, message)

function productionPlan(shot, anchors, planned = false) {
  if (!shot.action.trim()) throw invalidRequest(`镜头 ${shot.id} 缺少动作描述`)
  if (planned && (!shot.prompt_finalized || !shot.prompt?.trim())) throw invalidRequest(`镜头 ${shot.id} 的提示词尚未定稿`)
  const prompt = planned ? shot.prompt : shot.action
  const duration = planned ? { duration_seconds: shot.duration } : {}
  if (shot.mode === 't2va') return { mode: 't2va', prompt, ...duration }
  if (shot.mode !== 'i2va') throw invalidRequest(`镜头 ${shot.id} 的 ${shot.mode || '空'} 模式暂不支持项目直接生成`)
  const anchor = anchors.find(item => item.role === (shot.roles?.[0] || shot.role))
  const firstFrame = validJobId(anchor?.source?.job_id) ? `job:${anchor.source.job_id}` : serverUrl(anchor?.image_url) ? anchor.image_url : null
  if (!firstFrame) throw invalidRequest(`镜头 ${shot.id} 的 i2va 模式缺少有效角色锚点`)
  return { mode: 'i2va', prompt, first_frame: firstFrame, ...duration }
}

export function createProjectStore(options = {}) {
  const { submitTasks = submit, retryTask = retry, complete = completeStructured, ...storeOptions } = options
  const store = createStore({ readJob: getJob, summarizeJob: availableJobSummary, removeTasks: removeProjectTasks, ...storeOptions })
  store.createAnchorsFromCast = async (id, series) => {
    let project = await store.read(id)
    for (const item of series.characters) {
      if (project.anchors.some(anchor => anchor.role === item.id)) continue
      project = await store.changeAnchor(id, 'add', { role: item.id, kind: 'character', label: item.name,
        description: `${item.appearance}；音色：${item.voice}；性格：${item.personality}` })
    }
    for (const item of series.scenes) {
      const role = `scene-${item.id}`
      if (project.anchors.some(anchor => anchor.role === role)) continue
      project = await store.changeAnchor(id, 'add', { role, kind: 'scene', label: item.name, description: item.description })
    }
    return project
  }
  const composing = new Map()
  store.composeFilm = ({ id, episode }) => {
    const key = `${id}/${episode || 0}`
    if (composing.has(key)) return composing.get(key)
    const operation = (episode === undefined ? composeFilm(store, id) : composeEpisodeFilm(store, id, episode)).finally(() => composing.delete(key))
    composing.set(key, operation)
    return operation
  }
  store.planning = createPlanningService(store, complete)
  store.generateStoryboard = async ({ id }) => {
    const project = await store.read(id)
    if (project.acts.length) return project
    return store.initializeStoryboard(id, await generateStoryboard(project, complete))
  }
  store.produce = async ({ project_id: projectId, shot_ids: shotIds, submission_id: submissionId, episode }) => {
    if (!validProjectId(projectId)) throw invalidRequest('项目 ID 无效')
    if (!Array.isArray(shotIds) || !shotIds.length || shotIds.length > 1000 || shotIds.some(id => !validShotId(id)) || new Set(shotIds).size !== shotIds.length) throw invalidRequest('镜头 ID 列表无效')
    if (typeof submissionId !== 'string') throw invalidRequest('submission_id 无效')
    const project = episode === undefined ? await store.read(projectId) : await store.readEpisode(projectId, episode), wanted = new Set(shotIds)
    const shots = project.acts.flatMap(act => act.shots).filter(shot => wanted.has(shot.id))
    if (shots.length !== wanted.size) throw invalidRequest('镜头不存在')
    if (shots.some((shot, index) => shot.job_id && shot.job_id !== taskId(submissionId, index) && ['pending', 'queued', 'running'].includes(shot.status))) throw statusError(409, '所选镜头已有待执行任务')
    const result = await submitTasks({ submission_id: submissionId, lane: { id: `project-${projectId}-main`, priority: 'batch' }, project_id: projectId,
      tasks: shots.map(shot => ({ kind: 'video', plan: productionPlan(shot, project.anchors, episode !== undefined), binding: { type: 'shot', shot_id: shot.id, ...(episode === undefined ? {} : { episode }) } })), channel: 'project' })
    for (const [index, shot] of shots.entries()) await store.changeShot(projectId, 'update', { id: shot.id, episode, job_id: result.tasks[index].task_id, status: 'pending' })
    return { ...result, project: episode === undefined ? await store.read(projectId) : await store.readEpisode(projectId, episode) }
  }
  store.retryShot = async ({ project_id: projectId, task_id: taskId, episode }) => {
    if (!validProjectId(projectId) || !validJobId(taskId)) throw invalidRequest('项目或任务 ID 无效')
    const project = episode === undefined ? await store.read(projectId) : await store.readEpisode(projectId, episode)
    const shot = project.acts.flatMap(act => act.shots).find(item => item.job_id === taskId)
    if (!shot) throw invalidRequest('任务不属于该项目镜头')
    const job = await retryTask(taskId, { kind: 'video', consent: true })
    await store.changeShot(projectId, 'update', { id: shot.id, episode, job_id: job.job_id, status: job.status })
    return { job, project: episode === undefined ? await store.read(projectId) : await store.readEpisode(projectId, episode) }
  }
  return store
}

// 项目只解释自己的 binding；任务引擎仅负责至少投递一次。
export function registerProjectSinks(ctx, store) {
  const register = (type, handler) => ctx.effect(() => registerSink(type, handler), `elysium project ${type} sink`)
  register('shot', (job, task) => store.changeShot(task.project_id, 'update', { id: task.binding.shot_id, episode: task.binding.episode, expect_job_id: job.job_id, status: job.status }))
  register('anchor', (job, task) => store.changeAnchor(task.project_id, 'update', { role: task.binding.role,
    source: job.status === 'succeeded' ? { type: 'job', job_id: job.job_id } : null }))
}
