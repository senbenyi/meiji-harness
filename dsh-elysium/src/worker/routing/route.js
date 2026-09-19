// 职责：新任务的模型路由：选择后端 → 按全局创作质量准备计划 → 在该后端上下文中校验，产出任务的不可变快照。
import { creationQuality } from '../../config.js'
import { prepareBackendPlan, validateBackend, validateBackendPlan, withBackend } from '../models/index.js'
import { resolveGenerationBackend } from './selection.js'

export async function routeTask(kind, plan, { deferReferences = [] } = {}) {
  const backend = await resolveGenerationBackend(kind)
  await validateBackend(backend)
  const deferred = new Map()
  const validationPlan = replaceReferences(plan, value => {
    const match = /^job:([a-f0-9]{32})$/.exec(value)
    if (!match || !deferReferences.includes(match[1]) || backend.service !== 'comfyui') return value
    const placeholder = new URL('view', backend.base_url.replace(/\/?$/, '/'))
    placeholder.search = new URLSearchParams({ filename: `${match[1]}.png`, subfolder: 'elysium-pending', type: 'output' })
    deferred.set(placeholder.href, value)
    return placeholder.href
  })
  const prepared = await prepareBackendPlan(backend, validationPlan, creationQuality())
  await withBackend(backend, () => validateBackendPlan(backend, prepared))
  return { backend, plan: replaceReferences(prepared, value => deferred.get(value) || value) }
}

export async function validateRoutedTask(backend, plan) {
  await validateBackend(backend)
  await withBackend(backend, () => validateBackendPlan(backend, plan))
  return plan
}

export function replaceReferences(value, replace) {
  if (typeof value === 'string') return replace(value)
  if (Array.isArray(value)) return value.map(item => replaceReferences(item, replace))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item, replace)]))
  return value
}
