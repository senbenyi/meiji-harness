import { randomUUID } from 'node:crypto'
import { runOperation, validateOperation, operationLabel } from './actions.js'
import { insertSessionLog, runWithSessionLog } from './session-log.js'
import { notifyProject } from '../data/project-events.js'
import { projectStore } from '../data/projects.js'
import { feedbackOf } from '../../client/feedback.js'

export function generationFeedback(episode, action) {
  if (['storyboard', 'seconds'].includes(action)) {
    const nodes = episode.shots.items.map(shot => shot[action])
    return { status: nodes.every(node => node.check.passed === true && !node.stale) && nodes.length ? 'passed' : 'not-generated',
      stale: nodes.some(node => node.stale), check: { passed: nodes.length > 0 && nodes.every(node => node.check.passed === true && !node.stale), failures: nodes.flatMap(node => node.check.failures) } }
  }
  return feedbackOf(episode, { action })
}

export function createTasks({ home, workspaceController, execute = runOperation }) {
  const records = new Map()
  const snapshot = task => ({ id: task.id, taskId: task.id, ...task.result, action: task.operation.action, projectId: task.operation.projectId, status: task.status })
  const find = (id, sessionId) => {
    const task = records.get(id)
    if (!task || task.operation.sessionId !== sessionId) throw Object.assign(new Error('任务不存在或不属于当前会话'), { status: 404 })
    return task
  }
  const log = (session, text, failed = false, title) => {
    try { insertSessionLog(session, text, failed, title) } catch { /* Logs do not control task execution. */ }
  }
  return {
    list(projectId) {
      return [...records.values()].filter(task => task.status === 'running' && task.operation.projectId === projectId).map(task => ({ ...snapshot(task), episodeId: task.operation.episodeId, track: task.operation.track }))
    },
    get(id, sessionId) { return snapshot(find(id, sessionId)) },
    async wait(id, sessionId, signal) {
      const task = find(id, sessionId)
      signal?.throwIfAborted()
      let timer, abort
      try {
        await Promise.race([task.done, new Promise((resolve, reject) => {
          timer = setTimeout(resolve, 25000)
          abort = () => reject(signal.reason)
          signal?.addEventListener('abort', abort, { once: true })
        })])
      } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) }
      return snapshot(task)
    },
    start(operation, session) {
      validateOperation(operation)
      for (const task of records.values()) {
        const other = task.operation
        if (task.status === 'running' && other.projectId === operation.projectId && (!other.episodeId || !operation.episodeId || other.episodeId === operation.episodeId) && (!other.track || !operation.track || other.track === operation.track)) {
          throw Object.assign(new Error('上一项操作还在进行'), { status: 409 })
        }
      }
      const id = randomUUID(), controller = new AbortController()
      const task = { id, operation, controller, status: 'running', result: { episodeId: operation.episodeId } }
      records.set(id, task)
      task.done = runWithSessionLog(session, async () => {
        log(session, `任务 ${id} 开始：${operation.action}`, false, `日志-${operationLabel(operation)}-开始`)
        try {
          const trace = await execute(operation, { home, workspaceController, session, signal: controller.signal, operationId: id, waitForBackground: true })
          task.result = { ...task.result, ...trace.result }
          if (['episode-generate', 'outline', 'shots', 'seconds', 'storyboard'].includes(operation.action)) {
            const project = await projectStore(home).read(operation.projectId)
            const episode = project.episodes.find(item => item.id === task.result.episodeId)
            if (!episode) throw new Error('任务未保存目标剧集')
            const feedback = generationFeedback(episode, operation.action)
            task.result.reviewPassed = feedback.check.passed === true
            task.result.failures = feedback.check.failures
            task.status = feedback.check.passed === true ? 'completed' : 'review_failed'
          } else task.status = 'completed'
          log(session, `任务 ${id} 执行结束：${task.status}\n${trace.join('\n')}`, false, `日志-${operationLabel(operation)}-执行结束`)
        } catch (error) {
          task.status = controller.signal.aborted ? 'cancelled' : error.code === 'CONTENT_CHECK_FAILED' ? 'review_failed' : 'failed'
          task.result.error = error.message || '操作失败'
          log(session, `任务 ${id} 失败：${task.result.error}`, true, `日志-${operationLabel(operation)}-执行失败`)
        } finally {
          notifyProject(home, operation.projectId)
        }
        return snapshot(task)
      })
      notifyProject(home, operation.projectId)
      return { id, done: task.done }
    },
    cancel(id, projectId) {
      const task = records.get(id)
      if (!task || task.status !== 'running' || task.operation.projectId !== projectId) throw Object.assign(new Error('任务已结束或不存在'), { status: 404 })
      task.controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
    },
    dispose() { for (const task of records.values()) if (task.status === 'running') task.controller.abort(Object.assign(new Error('服务已停止，任务暂停'), { code: 'TASK_PAUSED' })) },
  }
}
