// 职责：为导演模式解析显式项目，或为自由模式切换到不可见内部工作区。
import { ensureFreeProject } from '../../worker/tasks/jobs/create.js'
import { isElysiumFreeAgent } from '../agent/index.js'

export const generationProjectId = (projectId, exec) => isElysiumFreeAgent(exec?.agent) ? ensureFreeProject() : projectId
