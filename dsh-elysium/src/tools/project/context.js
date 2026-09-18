// 职责：为生成工具解析显式项目，或在自由模式下切换到不可见内部工作区。
import { ensureFreeProject } from '../../server/jobs/create.js'
import { isElysiumFreeAgent } from '../agent.js'

export const generationProjectId = (projectId, exec) => isElysiumFreeAgent(exec?.agent) ? ensureFreeProject() : projectId
