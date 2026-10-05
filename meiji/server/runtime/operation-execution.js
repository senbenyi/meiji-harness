// 操作记录：一次点击（或会话调用）对应一条记录 history/operations/<operationId>.json，任务经 taskIds 关联。
// 操作状态只由任务状态推导（deriveOperationStatus），记录中的 status 是缓存。
import { recordStore } from '../data/task-store.js'
import { notifyProject } from '../data/project-events.js'
import { recorded } from './task-state.js'
import { deriveOperationStatus, deriveTaskStatus } from '../../shared/task-nodes.js'

export const OPERATION_SCHEMA = 1
const now = () => new Date().toISOString()

export async function createOperationRecord(home, operation, id, { taskIds = [], label = null, actor = 'model' } = {}) {
  if (!recorded(operation)) return null
  const record = {
    schemaVersion: OPERATION_SCHEMA, id, projectId: operation.projectId, episodeId: operation.episodeId || null, action: operation.action, label,
    source: operation.origin || 'api', initiator: operation.origin === 'session' ? 'session' : 'panel', actor,
    sessionId: operation.sessionId || null, mode: operation.draft ? 'draft' : operation.mode || operation.generationMode || (actor === 'human' ? 'edit' : 'generate'),
    callId: operation.callId || null, followUpOf: operation.followUpOf || null,
    requirements: operation.requirements || '', opinion: operation.review || operation.instruction || '',
    parameters: Object.fromEntries(['action', 'episodeId', 'mode', 'generationMode', 'requirements', 'review', 'track', 'only', 'parts', 'draft'].filter(key => operation[key] !== undefined).map(key => [key, operation[key]])),
    taskIds, status: 'queued', startedAt: now(), endedAt: null, error: null,
  }
  await recordStore(home, operation.projectId).update('operations', id, record)
  notifyProject(home, operation.projectId)
  return record
}

// 按任务记录重新推导并缓存操作状态；ended 时写入结束时间。
export async function refreshOperation(home, projectId, id, { ended = false, error = null } = {}) {
  const store = recordStore(home, projectId)
  let record
  try { record = await store.read('operations', id) } catch (reason) { if (reason.code === 'ENOENT') return null; throw reason }
  const statuses = []
  for (const taskId of record.taskIds) {
    try { statuses.push(deriveTaskStatus((await store.read('tasks', taskId)).nodes)) } catch (reason) { if (reason.code !== 'ENOENT') throw reason }
  }
  const saved = await store.update('operations', id, current => ({ ...current, status: deriveOperationStatus(statuses), ...(ended ? { endedAt: current.endedAt || now() } : {}), ...(error ? { error } : {}) }))
  notifyProject(home, projectId)
  return saved
}
