// 职责：组合 AutoDL 双服务器契约；工作流实现由本 provider 自身提供。
import { readFileSync } from 'node:fs'
import { createStandardAdapter } from '../../managers/runtime/adapter.js'
import { withBackend } from '../../managers/registry/resolve.js'
import { validateAutodl } from './config.js'
import { guidance } from './guidance.js'
import { buildImageGraph } from './workflows/image/graph.js'
import { executeComfyImage } from './workflows/image/execution.js'
import { isImagePlan, normalizeImagePlan, validateImagePlan } from './workflows/image/plan.js'
import { buildVideoGraph } from './workflows/minimax-h3/graph.js'
import { executeDirectorVideo } from './workflows/minimax-h3/execution.js'
import { buildVideoGraph as buildDirectorGraph, loadVideoTemplates } from './workflows/minimax-h3/director.js'
import { isDirectorPlan, toDirectorPlan, validatePlan as validateVideoPlan } from './workflows/minimax-h3/plan.js'

const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))
const adapter = createStandardAdapter({
  id: 'autodl', label: 'AutoDL', services: definition.services, llmRoute: definition.llm_route,
  checkPlans: definition.check_plans, validate: validateAutodl,
  validatePlan: (plan, backend) => withBackend(backend, () => isImagePlan(plan) ? validateImagePlan(plan) : validateVideoPlan(plan)),
  buildGraph: (backend, plan, jobId) => withBackend(backend, () => {
    if (isImagePlan(plan)) return buildImageGraph(normalizeImagePlan(plan), {}, jobId)
    if (isDirectorPlan(plan)) return loadVideoTemplates().then(templates => buildDirectorGraph(plan, {}, templates, jobId))
    return buildVideoGraph(plan, jobId)
  }),
})

const executeVideo = adapter.executeJob
adapter.generateImage = true
adapter.executeJob = (projectId, jobId, plan, backend, options) => withBackend(backend, () => {
  if (isImagePlan(plan)) return executeComfyImage(projectId, jobId, plan, backend, options)
  const director = toDirectorPlan(plan)
  return isDirectorPlan(plan) || director ? executeDirectorVideo(projectId, jobId, director || plan, backend, options)
    : executeVideo(projectId, jobId, plan, backend, options)
})
adapter.guidance = guidance
adapter.creationGuidance = () => guidance
adapter.syncWorkflows = async args => (await import('./workflows/sync.mjs')).main(args)
export default adapter
