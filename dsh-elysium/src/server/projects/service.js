// 职责：组合项目持久化、任务查询与媒体可用性校验，供路由和 Harness 工具使用。
import { createProjectStore as createStore } from '../../database/managers/projects.js'
import { getJob } from '../../worker/tasks/jobs/query.js'
import { availableJobSummary } from '../media/catalog.js'

export { projectSummary } from '../../database/managers/projects.js'
export const createProjectStore = options => createStore({ readJob: getJob, summarizeJob: availableJobSummary, ...options })
