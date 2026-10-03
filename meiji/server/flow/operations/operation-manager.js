// 操作管理器：面板与会话、生成与直接操作的唯一入口（启动、排队、等待、查询与停止）。
// 每次发起生成一个 operationId（操作记录 history/operations）与其任务（history/tasks，任务记录带 operationId）；
// 阶段 C 之前每个操作只有一个任务。任务状态由步骤推导，操作状态由任务状态推导（shared/task-steps.js），这里不给状态赋值。
// 同一集同一时间只允许一个操作（剧集占用，operation-occupancy.js）：生成类从入队起占用，直接操作在执行期间占用。
import { randomUUID } from 'node:crypto'
import { abandonTasks, beginTask, createTaskRecord } from '../../runtime/task-execution.js'
import { createOperationRecord, refreshOperation } from '../../runtime/operation-execution.js'
import { createStep, finalizeSteps, recorded } from '../../runtime/task-state.js'
import { liveTask } from '../../runtime/task-context.js'
import { recordStore } from '../../data/task-store.js'
import { readTaskDraft } from '../../data/content-records.js'
import { runOperation } from './run-operation.js'
import { validateOperation, operationLabel, planTasks, queueOf } from './operation-registry.js'
import { insertSessionLog, runWithSessionLog } from '../../host/session-log.js'
import { notifyProject } from '../../data/project-events.js'
import { projectIds } from '../../data/project-files.js'
import { defaults } from '../../../models/model-config.js'
import { createQueue, defaultConcurrency } from '../tasks/task-queue.js'
import { occupy } from './operation-occupancy.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { StepStatus, TaskStatus, deriveOperationStatus, deriveTaskStatus, reviewFailures, reviewPassed, taskEnded } from '../../../shared/task-steps.js'

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
const initiatorOf = operation => operation.origin === 'session' ? 'session' : 'panel'

export function createOperationManager({ home, workspaceController, execute = runOperation, limitOf = configuredLimit }) {
  const records = new Map()
  const queue = createQueue(limitOf)
  // 入队前写记录是异步的：按发起顺序串行写入，保证先发起的操作先进入队列。
  let admission = Promise.resolve()
  // 最新步骤：执行中读实时任务记录，结束后读落定的记录；不写记录的操作用内存步骤。
  const taskSteps = (entry, task) => liveTask(task.id)?.steps || task.steps
  const tasksOf = entry => entry.tasks.map(task => ({ id: task.id, type: task.type, label: task.label, steps: taskSteps(entry, task) }))
  const stepsOf = entry => tasksOf(entry).flatMap(task => task.steps)
  const statusOf = entry => deriveOperationStatus(tasksOf(entry).map(task => deriveTaskStatus(task.steps)))
  const summary = (tasks, error) => {
    const steps = tasks.flatMap(task => task.steps)
    return { status: deriveOperationStatus(tasks.map(task => deriveTaskStatus(task.steps))), reviewPassed: reviewPassed(steps), failures: reviewFailures(steps), ...(error ? { error } : {}) }
  }
  const snapshot = entry => {
    const tasks = tasksOf(entry)
    const result = summary(tasks, entry.error)
    const queued = result.status === TaskStatus.QUEUED
    return { id: entry.id, operationId: entry.id, taskId: entry.taskId, ...entry.result, action: entry.operation.action, projectId: entry.operation.projectId, ...result,
      tasks: tasks.map(task => ({ ...task, status: deriveTaskStatus(task.steps), steps: structuredClone(task.steps) })), steps: structuredClone(tasks.flatMap(task => task.steps)),
      queued, ...(queued ? { queuePosition: queue.position(entry.id) } : {}) }
  }
  // 按操作 id 或其任一任务 id 查找。
  const lookup = id => records.get(id) || [...records.values()].find(entry => entry.tasks.some(task => task.id === id)) || null
  const find = (id, sessionId) => {
    const entry = lookup(id)
    if (!entry || entry.operation.sessionId !== sessionId) throw Object.assign(new Error('操作不存在或不属于当前会话'), { status: 404 })
    return entry
  }
  const active = entry => !entry.finished && ![TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.REVIEW_FAILED, TaskStatus.CANCELLED].includes(statusOf(entry))
  const log = (session, text, failed = false, title) => {
    try { insertSessionLog(session, text, failed, title) } catch { /* Logs do not control execution. */ }
  }
  // 不写记录的操作：执行结束时落定内存中的步骤。
  const settleLocal = (entry, error) => {
    const { signal } = entry.controller, steps = entry.tasks[0].steps
    if (!signal.aborted && (!error || error.code === 'CONTENT_CHECK_FAILED')) {
      for (const step of steps) if (step.status === StepStatus.RUNNING) Object.assign(step, { status: StepStatus.COMPLETED, endedAt: new Date().toISOString() })
    }
    finalizeSteps(steps, error, signal)
  }
  // 结束后读取落定的任务记录；从未进入执行（排队中取消、启动前出错）的任务在这里落定，并刷新操作记录。
  const settle = async (entry, error) => {
    const { operation, controller } = entry
    if (entry.recorded) {
      const saved = await abandonTasks(home, operation.projectId, entry.tasks.map(task => task.id), error, controller.signal)
      const byId = new Map(saved.map(record => [record.id, record]))
      for (const task of entry.tasks) if (byId.has(task.id)) task.steps = byId.get(task.id).steps
      const failed = saved.find(record => record.error)
      if (failed && !entry.error) entry.error = failed.error
      await refreshOperation(home, operation.projectId, entry.id, { ended: true, error: error?.message || failed?.error || null })
      if (saved.length) return
    }
    settleLocal(entry, error)
  }
  const waitFor = async (entry, signal) => {
    signal?.throwIfAborted()
    let timer, abort
    try {
      await Promise.race([entry.done, new Promise((resolve, reject) => {
        timer = setTimeout(resolve, 25000)
        abort = () => reject(signal.reason)
        signal?.addEventListener('abort', abort, { once: true })
      })])
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) }
  }
  return {
    // 本项目未结束（排队中或执行中）的操作。
    list(projectId) {
      return [...records.values()].filter(entry => active(entry) && entry.operation.projectId === projectId).map(entry => ({ ...snapshot(entry), episodeId: entry.operation.episodeId, track: entry.operation.track, itemId: entry.operation.itemId, initiator: initiatorOf(entry.operation) }))
    },
    // 「当前任务」页：本集未结束的操作及其任务、步骤、排队位置。
    current(projectId, episodeId) {
      return [...records.values()].filter(entry => active(entry) && entry.operation.projectId === projectId && (!episodeId || !entry.operation.episodeId || entry.operation.episodeId === episodeId))
        .map(entry => ({ ...snapshot(entry), episodeId: entry.operation.episodeId || null, track: entry.operation.track || null, label: operationLabel(entry.operation), initiator: initiatorOf(entry.operation), actor: liveTask(entry.taskId)?.actor || 'model', startedAt: entry.startedAt }))
    },
    async get(id, sessionId) {
      if (lookup(id)) {
        const entry = find(id, sessionId)
        if (!active(entry)) await entry.done
        return snapshot(entry)
      }
      // 已结束的操作：按项目查找操作记录（旧任务记录按任务 id 兼容读取），不解析项目内容。
      for (const projectId of await projectIds(home)) {
        const store = recordStore(home, projectId)
        let operation = null, task
        try { operation = await store.read('operations', id) } catch (error) { if (error.code !== 'ENOENT') throw error }
        try { task = await store.read('tasks', operation ? operation.taskIds[0] : id) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        if ((operation || task).sessionId !== sessionId) throw Object.assign(new Error('操作不属于当前会话'), { status: 404 })
        const tasks = [task]
        for (const taskId of operation?.taskIds.slice(1) || []) {
          try { tasks.push(await store.read('tasks', taskId)) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return { ...await readTaskDraft(home, task), id: operation?.id || task.id, operationId: operation?.id || task.operationId || null, taskId: task.id, projectId: task.projectId, episodeId: task.episodeId,
          ...summary(tasks, operation?.error || task.error), tasks: tasks.map(item => ({ id: item.id, type: item.type, label: item.label, status: deriveTaskStatus(item.steps), steps: item.steps })), steps: tasks.flatMap(item => item.steps) }
      }
      throw Object.assign(new Error('操作不存在'), { status: 404 })
    },
    async wait(id, sessionId, signal) {
      if (!lookup(id)) return this.get(id, sessionId)
      const entry = find(id, sessionId)
      await waitFor(entry, signal)
      return snapshot(entry)
    },
    // 会话等待占用本集的其他操作（如面板发起）结束：只返回续跑所需的状态、审核结论与失败原因，不返回任务与步骤。
    async waitOccupant(id, signal, { projectId } = {}) {
      const entry = lookup(id)
      if (!entry || (projectId && entry.operation.projectId !== projectId)) throw Object.assign(new Error('操作不存在或不属于当前项目'), { status: 404 })
      await waitFor(entry, signal)
      const { status, reviewPassed: passed, failures, error } = summary(tasksOf(entry), entry.error)
      return { operationId: entry.id, occupant: true, status, reviewPassed: passed, failures, ...(error ? { error } : {}) }
    },
    start(operation, session) {
      validateOperation(operation)
      const id = randomUUID(), taskId = randomUUID(), controller = new AbortController(), label = operationLabel(operation)
      // 剧集占用：从入队起持有，操作结束（含排队中取消）时释放；同一集已被占用时抛出 409。
      const release = occupy(home, operation, { id, label })
      // 任务在入队时划分（planTasks）；划分完成前先用一个内存任务承接状态。
      const entry = { id, taskId, operation, controller, recorded: recorded(operation), tasks: [{ id: taskId, type: operation.action, label, steps: [createStep({ kind: 'execute' }, 'model')] }], result: { episodeId: operation.episodeId }, startedAt: new Date().toISOString(), error: null, finished: false }
      records.set(id, entry)
      entry.done = runWithSessionLog(session, async () => {
        log(session, `操作 ${id} 开始：${operation.action}`, false, `日志-${label}-开始`)
        try {
          // 入队前写入操作记录与各任务记录（含步骤计划；全部未执行 = 排队中）。
          const admitted = admission.then(async () => {
            if (!entry.recorded) return null
            const planned = (await planTasks(home, operation)).map((task, index) => ({ ...task, id: index === 0 ? taskId : randomUUID() }))
            await createOperationRecord(home, operation, id, { taskIds: planned.map(task => task.id), label })
            for (const task of planned) task.steps = (await createTaskRecord(home, operation, task.id, task.plan, { operationId: id, type: task.type, label: task.label, targets: task.targets })).steps
            return planned
          })
          admission = admitted.catch(() => {})
          const planned = await admitted
          if (planned) entry.tasks = planned
          const trace = await queue.run(queueOf(operation.action), controller.signal, async () => {
            // 出队：第一个任务的第一个步骤进入准备中（状态由排队中变为执行中）。
            if (entry.recorded) entry.tasks[0].steps = (await beginTask(home, operation, taskId, entry.tasks[0].plan, { operationId: id })).steps
            else Object.assign(entry.tasks[0].steps[0], { status: StepStatus.RUNNING, startedAt: new Date().toISOString() })
            if (entry.recorded) await refreshOperation(home, operation.projectId, id)
            notifyProject(home, operation.projectId)
            return execute(operation, { home, workspaceController, session, signal: controller.signal, operationId: taskId, operationRecordId: id, tasks: planned || undefined, waitForBackground: true })
          }, () => {
            log(session, `操作 ${id} 排队中：同类任务已达并发上限，前序任务结束后自动开始`, false, `日志-${label}-排队`)
          }, id)
          entry.result = { ...entry.result, ...trace.result }
          await settle(entry)
          log(session, `操作 ${id} 执行结束：${statusOf(entry)}\n${trace.join('\n')}`, false, `日志-${label}-执行结束`)
        } catch (error) {
          entry.error = error.message || '操作失败'
          try { await settle(entry, error) } catch { settleLocal(entry, error) }
          log(session, `操作 ${id} 失败：${entry.error}`, true, `日志-${label}-执行失败`)
        } finally {
          entry.finished = true
          release()
          notifyProject(home, operation.projectId)
        }
        return snapshot(entry)
      })
      notifyProject(home, operation.projectId)
      return { id, operationId: id, taskId, done: entry.done }
    },
    // 直接操作（编辑、删除、导入、确认图片等）：不排队，立即执行；同样占用剧集、写操作记录。
    async run(operation, deps = {}) {
      const id = randomUUID(), taskId = randomUUID()
      const release = occupy(home, operation, { id, label: operationLabel(operation) })
      try {
        if (recorded(operation)) await createOperationRecord(home, operation, id, { taskIds: [taskId], label: operationLabel(operation) })
        return await execute(operation, { home, workspaceController, ...deps, operationId: taskId, operationRecordId: id })
      } finally {
        release()
        if (recorded(operation)) await refreshOperation(home, operation.projectId, id, { ended: true }).catch(() => {})
      }
    },
    // 停止：按操作 id 或任务 id 停止整个操作；sessionId 给出时只能停止本会话发起的操作。不建记录。
    cancel(id, projectId, { sessionId } = {}) {
      const entry = lookup(id)
      if (!entry || !active(entry) || entry.operation.projectId !== projectId) throw Object.assign(new Error('操作已结束或不存在'), { status: 404 })
      if (sessionId !== undefined && entry.operation.sessionId !== sessionId) throw Object.assign(new Error('只能停止本会话发起的操作'), { status: 404 })
      entry.controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
    },
    // 服务关闭一律取消本地进行中操作；网关无取消接口，已提交的远端任务可能继续运行。
    dispose() { for (const entry of records.values()) if (active(entry)) entry.controller.abort(Object.assign(new Error('服务已停止，任务已取消'), { code: 'TASK_CANCELLED' })) },
  }
}
