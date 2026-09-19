// 职责：新任务的模型路由：选择后端 → 按全局创作质量准备计划 → 在该后端上下文中校验，产出任务的不可变快照。
import { creationQuality } from '../../config.js'
import { prepareBackendPlan, validateBackend, validateBackendPlan, withBackend } from '../models/index.js'
import { resolveGenerationBackend } from './selection.js'

export async function routeTask(kind, plan) {
  const backend = await resolveGenerationBackend(kind)
  await validateBackend(backend)
  const prepared = await prepareBackendPlan(backend, plan, creationQuality())
  await withBackend(backend, () => validateBackendPlan(backend, prepared))
  return { backend, plan: prepared }
}
