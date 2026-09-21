// 职责：优先使用显式项目，否则切换到不可见内部工作区。
import { ensureFreeProject } from '../../worker/index.js'

export const generationProjectId = projectId => projectId || ensureFreeProject()
