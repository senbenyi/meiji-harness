// 职责：为导演模式解析显式项目，或为自由、教学模式切换到不可见内部工作区。
import { ensureFreeProject } from '../../worker/tasks/jobs/create.js'
import { isElysiumStandaloneAgent } from '../agent/index.js'

export const generationProjectId = (projectId, exec) => isElysiumStandaloneAgent(exec?.agent) ? ensureFreeProject() : projectId
