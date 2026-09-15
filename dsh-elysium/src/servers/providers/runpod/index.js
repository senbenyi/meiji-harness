// 职责：组合 Runpod 的完整平台契约，供业务和其他平台参考；不依赖兄弟 provider。
import { createStandardAdapter } from '../../standard-adapter.js'
import { buildVideoGraph } from './workflows/minimax-h3/graph.js'
import { withBackend } from '../../resolve.js'
import { validateRunpod } from './config.js'
const adapter = createStandardAdapter({
  buildGraph: (backend, plan, jobId) => withBackend(backend, () => buildVideoGraph(plan, jobId)),
  id: 'runpod', label: 'Runpod', validate: validateRunpod,
  // 服务管理仅由显式 CLI 调用，加载插件、创建任务和检查服务不会启动或停止远端进程。
  manage: async (action, options) => (await import('./service.mjs')).manageService(action, options),
})

adapter.syncWorkflows = async args => (await import('./workflows/sync.mjs')).main(args)
export default adapter
