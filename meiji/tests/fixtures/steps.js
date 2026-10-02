import { executionContext } from '../../server/runtime/task-context.js'

// 在内存中的任务上下文里执行 run，返回它记录的步骤（不写文件）。
export async function recordSteps(run, steps = []) {
  const context = { store: { update: async (_kind, _id, change) => typeof change === 'function' ? change({}) : change }, home: '/tmp', taskId: 'test-steps', projectId: 'test-steps',
    operation: {}, stage: null, baselines: new Map(), outputs: [], steps, signal: null, stepId: null, scope: 'root' }
  const result = await executionContext.run(context, run)
  return { result, steps }
}
