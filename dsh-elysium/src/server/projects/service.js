// 职责：组合项目持久化、任务查询与媒体可用性校验，供路由和 Harness 工具使用。
import { createProjectStore as createStore } from '../../database/managers/projects.js'
import { completeStructured, getJob, registerSink, removeProjectTasks, retry, submit, taskId } from '../../worker/index.js'
import { availableJobSummary } from '../media/catalog.js'
import { serverUrl, validJobId, validProjectId, validShotId } from './schema.js'
import { statusError } from '../../utils/errors.js'
import { generateStoryboard } from './storyboard.js'

export { projectSummary } from '../../database/managers/projects.js'
const invalidRequest = message => statusError(400, message)

function productionPlan(shot, anchors) {
  if (!shot.action.trim()) throw invalidRequest(`镜头 ${shot.id} 缺少动作描述`)
  if (shot.mode === 't2va') return { mode: 't2va', prompt: shot.action }
  if (shot.mode !== 'i2va') throw invalidRequest(`镜头 ${shot.id} 的 ${shot.mode || '空'} 模式暂不支持项目直接生成`)
  const anchor = anchors.find(item => item.role === shot.role)
  const firstFrame = validJobId(anchor?.source?.job_id) ? `job:${anchor.source.job_id}` : serverUrl(anchor?.image_url) ? anchor.image_url : null
  if (!firstFrame) throw invalidRequest(`镜头 ${shot.id} 的 i2va 模式缺少有效角色锚点`)
  return { mode: 'i2va', prompt: shot.action, first_frame: firstFrame }
}

export function createProjectStore(options = {}) {
  const { submitTasks = submit, retryTask = retry, complete = completeStructured, ...storeOptions } = options
  const store = createStore({ readJob: getJob, summarizeJob: availableJobSummary, removeTasks: removeProjectTasks, ...storeOptions })
  store.generateStoryboard = async ({ id }) => {
    const project = await store.read(id)
    if (project.acts.length) return project
    return store.initializeStoryboard(id, await generateStoryboard(project, complete))
  }
  store.produce = async ({ project_id: projectId, shot_ids: shotIds, submission_id: submissionId }) => {
    if (!validProjectId(projectId)) throw invalidRequest('项目 ID 无效')
    if (!Array.isArray(shotIds) || !shotIds.length || shotIds.length > 1000 || shotIds.some(id => !validShotId(id)) || new Set(shotIds).size !== shotIds.length) throw invalidRequest('镜头 ID 列表无效')
    if (typeof submissionId !== 'string') throw invalidRequest('submission_id 无效')
    const project = await store.read(projectId), wanted = new Set(shotIds)
    const shots = project.acts.flatMap(act => act.shots).filter(shot => wanted.has(shot.id))
    if (shots.length !== wanted.size) throw invalidRequest('镜头不存在')
    if (shots.some((shot, index) => shot.job_id && shot.job_id !== taskId(submissionId, index) && ['pending', 'queued', 'running'].includes(shot.status))) throw statusError(409, '所选镜头已有待执行任务')
    const result = await submitTasks({ submission_id: submissionId, lane: { id: `project-${projectId}-main`, priority: 'batch' }, project_id: projectId,
      tasks: shots.map(shot => ({ kind: 'video', plan: productionPlan(shot, project.anchors), binding: { type: 'shot', shot_id: shot.id } })), channel: 'project' })
    for (const [index, shot] of shots.entries()) await store.changeShot(projectId, 'update', { id: shot.id, job_id: result.tasks[index].task_id, status: 'pending' })
    return { ...result, project: await store.read(projectId) }
  }
  store.retryShot = async ({ project_id: projectId, task_id: taskId }) => {
    if (!validProjectId(projectId) || !validJobId(taskId)) throw invalidRequest('项目或任务 ID 无效')
    const project = await store.read(projectId), shot = project.acts.flatMap(act => act.shots).find(item => item.job_id === taskId)
    if (!shot) throw invalidRequest('任务不属于该项目镜头')
    const job = await retryTask(taskId, { kind: 'video', consent: true })
    await store.changeShot(projectId, 'update', { id: shot.id, job_id: job.job_id, status: job.status })
    return { job, project: await store.read(projectId) }
  }
  return store
}

// 项目只解释自己的 binding；任务引擎仅负责至少投递一次。
export function registerProjectSinks(ctx, store) {
  const register = (type, handler) => ctx.effect(() => registerSink(type, handler), `elysium project ${type} sink`)
  register('shot', (job, task) => store.changeShot(task.project_id, 'update', { id: task.binding.shot_id, job_id: job.job_id, status: job.status }))
  register('anchor', (job, task) => store.changeAnchor(task.project_id, 'update', { role: task.binding.role,
    source: job.status === 'succeeded' ? { type: 'job', job_id: job.job_id } : null }))
}
