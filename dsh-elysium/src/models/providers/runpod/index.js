// 职责：组合 Runpod 的完整平台契约，供业务和其他平台参考；不依赖兄弟 provider。
import { createStandardAdapter } from '../../managers/runtime/adapter.js'
import { buildVideoGraph } from './workflows/minimax-h3/graph.js'
import { withBackend } from '../../managers/registry/resolve.js'
import { readFileSync } from 'node:fs'
import { validatePlan } from './plan.js'
import { guidance } from './guidance.js'
import { validateRunpod } from './config.js'
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))
const adapter = createStandardAdapter({
  buildGraph: (backend, plan, jobId) => withBackend(backend, () => buildVideoGraph(plan, jobId)),
  id: 'runpod', label: 'Runpod', services: definition.services, llmRoute: definition.llm_route, checkPlans: definition.check_plans, validatePlan, validate: validateRunpod,
  // 服务管理仅由显式 CLI 调用，加载插件、创建任务和检查服务不会启动或停止远端进程。
  manage: async (action, options) => (await import('./service.mjs')).manageService(action, options),
})

adapter.guidance = guidance
adapter.creationGuidance = () => guidance
adapter.syncWorkflows = async args => (await import('./workflows/sync.mjs')).main(args)
export default adapter
