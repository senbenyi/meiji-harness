// 按内容 target 查询操作与任务；状态始终由节点推导，记录里的 status 仅作缓存。
import { readTaskDraft } from './content-records.js'
import { recordStore } from './task-store.js'
import { projectIds } from './project-files.js'
import { deriveTaskStatus, deriveOperationStatus } from '../../shared/task-nodes.js'
export const matchesTarget = (target, pattern) => pattern.endsWith(':*') ? target?.startsWith(pattern.slice(0, -1)) : target === pattern
export const withStatus = task => ({ ...task, status: deriveTaskStatus(task.nodes) })
const targetsOf = task => [...(task.targets || []), task.target, ...(task.artifacts || []).map(item => item.target), ...(task.latestOutputs || []).map(item => item.target)].filter(Boolean)
const relevant = (task, targets) => !targets.length || targetsOf(task).some(target => targets.some(pattern => matchesTarget(target, pattern)))
export async function readOperation(home, projectId, id) {
  const store = recordStore(home, projectId), operation = await store.read('operations', id)
  if (operation.projectId !== projectId) throw Object.assign(new Error('操作不属于本项目'), { status: 404 })
  const tasks = await Promise.all(operation.taskIds.map(async id => withStatus(await store.read('tasks', id))))
  const draftTask = tasks.find(task => task.type === operation.action)
  return { ...operation, ...(draftTask ? await readTaskDraft(home, draftTask) : {}), tasks, status: deriveOperationStatus(tasks.map(task => task.status)) }
}
export async function findGoalOperation(home, sessionId, goalId) {
  for (const projectId of await projectIds(home)) {
    const operation = (await recordStore(home, projectId).list('operations')).find(item => item.sessionId === sessionId && item.goalRef?.id === goalId)
    if (operation) return readOperation(home, projectId, operation.id)
  }
}
export async function listHistory(home, projectId, { episodeId, targets = [], status, tasksOnly = false } = {}) {
  const store = recordStore(home, projectId)
  const tasks = (await store.list('tasks')).map(withStatus).filter(task => (!episodeId || task.episodeId === episodeId) && relevant(task, targets))
  if (tasksOnly) return tasks.filter(task => !status || task.status === status).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const operationIds = new Set(tasks.map(task => task.operationId))
  const operations = []
  for (const id of operationIds) operations.push(await readOperation(home, projectId, id))
  return operations.filter(operation => !status || operation.status === status).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
