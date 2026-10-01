// 任务执行器：会话与面板共用的任务启动、排队、等待、查询与取消。
// 入队时写入任务记录与完整步骤计划；任务状态只由步骤推导（shared/steps.js 的 deriveTaskStatus），这里不给状态赋值。
// 不写记录的操作（创建、打开、删除等）在内存中保留一个 execute 步骤，同样由它推导状态。
import { randomUUID } from 'node:crypto'
import { abandonTask, beginTask, createTaskRecord, finalizeSteps, liveTask, recorded, recordStore, readTaskDraft } from '../../data/task-store.js'
import { runOperation, validateOperation, operationLabel } from '../operations/run.js'
import { planSteps, queueOf } from '../operations/registry.js'
import { insertSessionLog, runWithSessionLog } from '../../host/session-log.js'
import { notifyProject } from '../../data/project-events.js'
import { projectIds } from '../../data/project-files.js'
import { defaults } from '../../../models/model-config.js'
import { createQueue, defaultConcurrency } from './queue.js'
import { feedbackOf } from '../../../shared/feedback.js'
import { StepStatus, TaskStatus, deriveTaskStatus, reviewFailures, reviewPassed, taskEnded } from '../../../shared/steps.js'

export function generationFeedback(episode, action) {
  if (['storyboard', 'seconds'].includes(action)) {
    const nodes = episode.shots.items.map(shot => shot[action])
    return { status: nodes.every(node => node.check.passed === true && !node.stale) && nodes.length ? 'passed' : 'not-generated',
      stale: nodes.some(node => node.stale), check: { passed: nodes.length > 0 && nodes.every(node => node.check.passed === true && !node.stale), failures: nodes.flatMap(node => node.check.failures) } }
  }
  return feedbackOf(episode, { action })
}

// 并发上限来自部署配置 config/models.json（可由 config/models.local.json 覆盖）的 concurrency。
const configuredLimit = async kind => (await defaults()).concurrency?.[kind] ?? defaultConcurrency[kind]

// 不写记录的操作在内存中保留的步骤（与 task-store 的计划步骤同形）。
const localStep = () => ({ id: randomUUID(), kind: 'execute', target: null, label: null, status: StepStatus.PENDING, verdict: null, reasons: [], error: null, actor: 'model', attempts: [], inputs: [], outputs: [], startedAt: null, endedAt: null })

export function createTasks({ home, workspaceController, execute = runOperation, limitOf = configuredLimit }) {
  const records = new Map()
  const queue = createQueue(limitOf)
  // 入队前写记录是异步的：按发起顺序串行写入，保证先发起的任务先进入队列。
  let admission = Promise.resolve()
  // 最新步骤：执行中读实时记录，结束后读落定的记录；不写记录的操作用内存步骤。
  const stepsOf = task => liveTask(task.id)?.steps || task.steps
  const statusOf = task => deriveTaskStatus(stepsOf(task))
  const summary = (steps, error) => ({ status: deriveTaskStatus(steps), reviewPassed: reviewPassed(steps), failures: reviewFailures(steps), ...(error ? { error } : {}) })
  const snapshot = task => {
    const steps = stepsOf(task)
    const status = deriveTaskStatus(steps)
    return { id: task.id, taskId: task.id, ...task.result, action: task.operation.action, projectId: task.operation.projectId, ...summary(steps, task.error),
      queued: status === TaskStatus.QUEUED, ...(status === TaskStatus.QUEUED ? { queuePosition: queue.position(task.id) } : {}) }
  }
  const find = (id, sessionId) => {
    const task = records.get(id)
    if (!task || task.operation.sessionId !== sessionId) throw Object.assign(new Error('任务不存在或不属于当前会话'), { status: 404 })
    return task
  }
  const active = task => !task.finished && !taskEnded(stepsOf(task))
  const log = (session, text, failed = false, title) => {
    try { insertSessionLog(session, text, failed, title) } catch { /* Logs do not control task execution. */ }
  }
  // 不写记录的操作：执行结束时落定内存中的步骤。
  const settleLocal = (task, error) => {
    const { signal } = task.controller
    if (!signal.aborted && (!error || error.code === 'CONTENT_CHECK_FAILED')) {
      for (const step of task.steps) if (step.status === StepStatus.RUNNING) Object.assign(step, { status: StepStatus.COMPLETED, endedAt: new Date().toISOString() })
    }
    finalizeSteps(task.steps, error, signal)
  }
  // 结束后读取落定的记录；从未进入执行（排队中取消、启动前出错）的任务在这里落定。
  const settle = async (task, error) => {
    const { operation, controller } = task
    if (task.recorded) {
      let saved = null
      try { saved = await recordStore(home, operation.projectId).read('tasks', task.id) } catch (reason) { if (reason.code !== 'ENOENT') throw reason }
      if (saved && !saved.endedAt) saved = await abandonTask(home, operation.projectId, task.id, error, controller.signal)
      if (saved) { task.steps = saved.steps; if (saved.error) task.error = saved.error; return }
    }
    settleLocal(task, error)
  }
  return {
    // 本项目未结束（排队中或执行中）的任务。
    list(projectId) {
      return [...records.values()].filter(task => active(task) && task.operation.projectId === projectId).map(task => ({ ...snapshot(task), episodeId: task.operation.episodeId, track: task.operation.track }))
    },
    // 「当前任务」页：本集未结束的任务及其步骤、排队位置。
    current(projectId, episodeId) {
      return [...records.values()].filter(task => active(task) && task.operation.projectId === projectId && (!episodeId || !task.operation.episodeId || task.operation.episodeId === episodeId))
        .map(task => ({ ...snapshot(task), episodeId: task.operation.episodeId || null, track: task.operation.track || null, label: operationLabel(task.operation), actor: liveTask(task.id)?.actor || 'model', startedAt: task.startedAt, steps: stepsOf(task) }))
    },
    async get(id, sessionId) {
      if (records.has(id)) {
        const task = find(id, sessionId)
        if (taskEnded(stepsOf(task))) await task.done
        return snapshot(task)
      }
      // 按项目 id 直接查找任务文件，不解析项目内容。
      for (const projectId of await projectIds(home)) {
        let task
        try { task = await recordStore(home, projectId).read('tasks', id) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        if (task.sessionId !== sessionId) throw Object.assign(new Error('任务不属于当前会话'), { status: 404 })
        return { ...await readTaskDraft(home, task), id: task.id, taskId: task.id, projectId: task.projectId, episodeId: task.episodeId, ...summary(task.steps, task.error) }
      }
      throw Object.assign(new Error('任务不存在'), { status: 404 })
    },
    async wait(id, sessionId, signal) {
      if (!records.has(id)) return this.get(id, sessionId)
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
        if (active(task) && other.projectId === operation.projectId && (!other.episodeId || !operation.episodeId || other.episodeId === operation.episodeId) && (!other.track || !operation.track || other.track === operation.track)) {
          throw Object.assign(new Error('上一项操作还在进行'), { status: 409 })
        }
      }
      const id = randomUUID(), controller = new AbortController()
      const task = { id, operation, controller, recorded: recorded(operation), steps: [localStep()], result: { episodeId: operation.episodeId }, startedAt: new Date().toISOString(), error: null, finished: false }
      records.set(id, task)
      task.done = runWithSessionLog(session, async () => {
        log(session, `任务 ${id} 开始：${operation.action}`, false, `日志-${operationLabel(operation)}-开始`)
        try {
          // 入队前写入记录与完整步骤计划（全部未执行 = 排队中）。
          const admitted = admission.then(async () => task.recorded ? createTaskRecord(home, operation, id, await planSteps(home, operation)) : null)
          admission = admitted.catch(() => {})
          const record = await admitted
          if (record) task.steps = record.steps
          const trace = await queue.run(queueOf(operation.action), controller.signal, async () => {
            // 出队：第一个步骤进入准备中（任务状态由排队中变为执行中）。
            if (task.recorded) task.steps = (await beginTask(home, operation, id, await planSteps(home, operation))).steps
            else Object.assign(task.steps[0], { status: StepStatus.RUNNING, startedAt: new Date().toISOString() })
            notifyProject(home, operation.projectId)
            return execute(operation, { home, workspaceController, session, signal: controller.signal, operationId: id, waitForBackground: true })
          }, () => {
            log(session, `任务 ${id} 排队中：同类任务已达并发上限，前序任务结束后自动开始`, false, `日志-${operationLabel(operation)}-排队`)
          }, id)
          task.result = { ...task.result, ...trace.result }
          await settle(task)
          log(session, `任务 ${id} 执行结束：${statusOf(task)}\n${trace.join('\n')}`, false, `日志-${operationLabel(operation)}-执行结束`)
        } catch (error) {
          task.error = error.message || '操作失败'
          try { await settle(task, error) } catch { settleLocal(task, error) }
          log(session, `任务 ${id} 失败：${task.error}`, true, `日志-${operationLabel(operation)}-执行失败`)
        } finally {
          task.finished = true
          notifyProject(home, operation.projectId)
        }
        return snapshot(task)
      })
      notifyProject(home, operation.projectId)
      return { id, done: task.done }
    },
    cancel(id, projectId) {
      const task = records.get(id)
      if (!task || !active(task) || task.operation.projectId !== projectId) throw Object.assign(new Error('任务已结束或不存在'), { status: 404 })
      task.controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
    },
    // 服务关闭一律取消进行中任务（与用户点击停止相同：已提交的远端任务会收到取消请求）。
    dispose() { for (const task of records.values()) if (active(task)) task.controller.abort(Object.assign(new Error('服务已停止，任务已取消'), { code: 'TASK_CANCELLED' })) },
  }
}
