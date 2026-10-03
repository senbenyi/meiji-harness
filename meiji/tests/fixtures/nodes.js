import { executionContext } from '../../server/runtime/task-context.js'

// 在内存中的任务上下文里执行 run，返回它记录的步骤（不写文件）。
export async function recordSteps(run, nodes = []) {
  const context = { store: { update: async (_kind, _id, change) => typeof change === 'function' ? change({}) : change }, home: '/tmp', taskId: 'test-nodes', projectId: 'test-nodes',
    operation: {}, stage: null, baselines: new Map(), outputs: [], nodes, signal: null, nodeId: null, scope: 'root' }
  const result = await executionContext.run(context, run)
  return { result, nodes }
}
