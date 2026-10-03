import { createOperationManager } from '../../server/flow/operations/operation-manager.js'
import { executeTask } from '../../server/flow/shared/task-executor.js'
export async function runOperation(operation, deps) {
  if (deps.task) return executeTask(operation, deps)
  const manager = createOperationManager({ home: deps.home, workspaceController: deps.workspaceController })
  const started = manager.start(operation, deps.session, deps), result = await started.done
  if (started.failure) throw started.failure
  const trace = result.trace || []; trace.result = result.result || {}; return trace
}
export async function latestTask(store, target) {
  return (await store.list()).filter(task => !target || task.targets?.includes(target)).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '') || (b.endedAt || '').localeCompare(a.endedAt || ''))[0]
}
