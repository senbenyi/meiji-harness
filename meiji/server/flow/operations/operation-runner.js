// 操作按声明顺序展开任务；任务 ID 只在这里产生。任务执行由注册表指定，不相互调用操作。
import { randomUUID } from 'node:crypto'
import { planTasks, operationLabel } from './operation-registry.js'
import { createOperationRecord } from '../../runtime/operation-execution.js'
import { createTaskRecord } from '../../runtime/task-execution.js'
import { recorded } from '../../runtime/task-state.js'

export async function prepareOperation(home, operation, operationId) {
  const tasks = (await planTasks(home, operation)).map(task => ({ ...task, id: randomUUID() }))
  if (recorded(operation) && tasks.length) {
    await createOperationRecord(home, operation, operationId, { taskIds: tasks.map(task => task.id), label: operationLabel(operation), actor: tasks[0]?.actor })
    for (const task of tasks) task.nodes = (await createTaskRecord(home, operation, task.id, task.plan, { ...task, operationId })).nodes
  }
  return tasks
}
