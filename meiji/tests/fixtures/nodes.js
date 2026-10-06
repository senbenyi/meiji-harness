import { executionContext } from '../../server/runtime/task-context.js'

// 在内存中的单步上下文里执行 run，返回该步骤内部记录的动作（attempts，不写文件）：
// 每项含 kind、target、status（done / paused）、verdict、reasons、round。
export async function recordSteps(run, { kind = 'generate', target = null } = {}) {
  const step = { id: 'step', kind, target, scope: 'root', attempts: [], inputs: [], outputs: [], prompts: [], responses: [] }
  const store = { updateStep: async () => ({ revision: 0 }), update: async () => {}, list: async () => [] }
  const context = { store, home: '/tmp', projectId: 'test-nodes', runId: 'run', stepId: step.id, nodeId: step.id, scope: 'root',
    operation: {}, stage: null, baselines: new Map(), outputs: [], nodes: [step], signal: null, skills: new Map() }
  const result = await executionContext.run(context, run)
  return { result, nodes: step.attempts.filter(attempt => attempt.kind), step }
}
