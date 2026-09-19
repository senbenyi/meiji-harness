// 职责：组合项目持久化、任务查询与媒体可用性校验，供路由和 Harness 工具使用。
import { createProjectStore as createStore } from '../../database/managers/projects.js'
import { getJob, registerSink, removeProjectTasks } from '../../worker/index.js'
import { availableJobSummary } from '../media/catalog.js'

export { projectSummary } from '../../database/managers/projects.js'
export const createProjectStore = options => createStore({ readJob: getJob, summarizeJob: availableJobSummary, removeTasks: removeProjectTasks, ...options })

// 项目只解释自己的 binding；任务引擎仅负责至少投递一次。
export function registerProjectSinks(ctx, store) {
  const register = (type, handler) => ctx.effect(() => registerSink(type, handler), `elysium project ${type} sink`)
  register('shot', (job, task) => store.changeShot(task.project_id, 'update', { id: task.binding.shot_id, job_id: job.job_id, status: job.status }))
  register('anchor', (job, task) => store.changeAnchor(task.project_id, 'update', { role: task.binding.role,
    source: job.status === 'succeeded' ? { type: 'job', job_id: job.job_id } : null }))
}
