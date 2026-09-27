import { randomUUID } from 'node:crypto'
import { runOperation, validateOperation, operationLabel } from './actions.js'
import { insertSessionLog, runWithSessionLog } from './session-log.js'
import { notifyProject } from '../data/project-events.js'

export function createPanelTasks({ home, workspaceController, execute = runOperation }) {
  const active = new Map()
  const log = (session, text, failed = false, title) => {
    try { insertSessionLog(session, text, failed, title) } catch { /* Logs do not control task execution. */ }
  }
  return {
    list(projectId) {
      return [...active.values()].filter(task => task.operation.projectId === projectId).map(({ id, operation }) => ({ id, action: operation.action, episodeId: operation.episodeId, track: operation.track }))
    },
    start(operation, session) {
      validateOperation(operation)
      for (const task of active.values()) {
        const other = task.operation
        if (other.projectId === operation.projectId && (!other.episodeId || !operation.episodeId || other.episodeId === operation.episodeId) && (!other.track || !operation.track || other.track === operation.track)) {
          throw Object.assign(new Error('上一项面板操作还在进行'), { status: 409 })
        }
      }
      const id = randomUUID(), controller = new AbortController()
      active.set(id, { id, operation, controller })
      const done = runWithSessionLog(session, async () => {
        log(session, `任务 ${id} 开始：${operation.action}`, false, `日志-${operationLabel(operation)}-点击按钮`)
        try {
          const trace = await execute(operation, { home, workspaceController, session, signal: controller.signal, operationId: id, waitForBackground: true })
          log(session, `任务 ${id} 执行结束，审核结果以卡片状态为准\n${trace.join('\n')}`, false, `日志-${operationLabel(operation)}-执行结束`)
        } catch (error) {
          log(session, `任务 ${id} 失败：${error.message || '操作失败'}`, true, `日志-${operationLabel(operation)}-执行失败`)
        } finally {
          active.delete(id)
          notifyProject(home, operation.projectId)
        }
      })
      notifyProject(home, operation.projectId)
      return { id, done }
    },
    cancel(id, projectId) {
      const task = active.get(id)
      if (!task || task.operation.projectId !== projectId) throw Object.assign(new Error('任务已结束或不存在'), { status: 404 })
      task.controller.abort(new Error('任务已停止'))
    },
    dispose() { for (const task of active.values()) task.controller.abort(Object.assign(new Error('服务已停止，任务暂停'), { code: 'TASK_PAUSED' })) },
  }
}
