import { createOperationManager } from '../../server/flow/operations/operation-manager.js'
import { projectStore } from '../../server/data/project-store.js'
import { reviewPass } from './review-result.js'
import { executeTask } from '../../server/flow/shared/task-executor.js'
export async function runOperation(operation, deps) {
  if (deps.task) return executeTask(operation, deps)
  const syncRequest = async message => {
    if (message.skill === 'review') return reviewPass
    const root = await projectStore(deps.home).read(operation.projectId)
    const episode = root.episodes.find(item => item.summary.basis?.scriptSyncedRevision !== item.summary.revision)
    const exists = root.scriptSections.sections.some(item => item.episodeId === episode?.id)
    return JSON.stringify(root.scriptKind === 'assembled' && episode && !exists
      ? { needsChange: true, note: '测试回写', changes: [{ target: { kind: 'episode', episodeId: episode.id }, before: '', after: episode.summary.content }] }
      : { needsChange: false, note: '测试回写无需修改', changes: [] })
  }
  const manager = createOperationManager({ home: deps.home, workspaceController: deps.workspaceController,
    execute: (op, options) => executeTask(op, op.action === 'script-sync' ? { ...options, request: syncRequest } : options.task.type === 'project-summary' && operation.action !== 'project-summary' ? { ...options, request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '旅人的冒险' }) } : options) })
  const started = manager.start(operation, deps.session, deps), result = await started.done
  if (result.result?.scriptSyncOperationId) {
    let child
    do { child = await manager.whenEnded(result.result.scriptSyncOperationId, { sessionId: operation.sessionId }) } while (['queued', 'running'].includes(child.status))
  }
  if (started.failure) throw started.failure
  const trace = result.trace || []; trace.result = result.result || {}; return trace
}
export async function latestTask(store, target) {
  return (await store.list()).filter(task => !target || task.targets?.includes(target)).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '') || (b.endedAt || '').localeCompare(a.endedAt || ''))[0]
}
