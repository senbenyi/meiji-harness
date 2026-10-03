// 唯一发起入口：操作持有剧集占用，每个任务独立排队；失败、审核未通过、停止均取消剩余任务。
import { randomUUID } from 'node:crypto'
import { createQueue, defaultConcurrency } from '../tasks/task-queue.js'
import { prepareOperation } from './operation-runner.js'
import { executeTask } from '../shared/task-executor.js'
import { validateOperation, operationLabel } from './operation-registry.js'
import { occupy } from './operation-occupancy.js'
import { projectStore } from '../../data/project-store.js'
import { defaults } from '../../../models/model-config.js'
import { beginTask } from '../../runtime/task-execution.js'
import { createNode, finalizeNodes, recorded } from '../../runtime/task-state.js'
import { liveTask, liveTasks } from '../../runtime/task-context.js'
import { refreshOperation } from '../../runtime/operation-execution.js'
import { recordStore } from '../../data/task-store.js'
import { readTaskDraft } from '../../data/content-records.js'
import { projectIds } from '../../data/project-files.js'
import { notifyProject } from '../../data/project-events.js'
import { insertSessionLog, runWithSessionLog } from '../../host/session-log.js'
import { StepStatus, deriveOperationStatus, deriveTaskStatus, reviewPassed, reviewFailures } from '../../../shared/task-nodes.js'
import { feedbackOf } from '../../../shared/review-feedback.js'

export function generationFeedback(episode, action) {
  if (['storyboard', 'seconds'].includes(action)) {
    const nodes = episode.shots.items.map(shot => shot[action])
    return { stale: nodes.some(node => node.stale), check: { passed: nodes.length > 0 && nodes.every(node => node.check.passed === true && !node.stale), failures: nodes.flatMap(node => node.check.failures) } }
  }
  return feedbackOf(episode, { action })
}
const configuredLimit = async kind => (await defaults()).concurrency?.[kind] ?? defaultConcurrency[kind]
const ended = status => ['completed', 'failed', 'review_failed', 'cancelled'].includes(status)
const now = () => new Date().toISOString()
const initiatorOf = op => op.origin === 'session' ? 'session' : 'panel'
const failureSummary = tasks => tasks.filter(task => ['failed', 'review_failed'].includes(deriveTaskStatus(task.nodes))).map(task => `${task.label || task.type}：${reviewFailures(task.nodes).join('；') || task.error || task.nodes.find(node => node.error)?.error || '执行失败'}`)
const resultOf = tasks => ({ status: deriveOperationStatus(tasks.map(task => deriveTaskStatus(task.nodes))), reviewPassed: reviewPassed(tasks.flatMap(task => task.nodes)), failures: failureSummary(tasks) })

export function createOperationManager({ home, workspaceController, execute = executeTask, limitOf = configuredLimit }) {
  const entries = new Map(), queue = createQueue(limitOf)
  let admission = Promise.resolve()
  const tasksOf = entry => entry.tasks.map(task => ({ ...task, ...(liveTask(task.id) || {}), nodes: liveTask(task.id)?.nodes || task.nodes }))
  const snapshot = entry => {
    const tasks = tasksOf(entry), result = resultOf(tasks)
    return { id: entry.id, operationId: entry.id, projectId: entry.op.projectId, episodeId: entry.op.episodeId || entry.result?.episodeId || null,
      action: entry.op.action, parts: entry.op.parts, only: entry.op.only, draftMode: entry.op.draft, track: entry.op.track || null, itemId: entry.op.itemId || null, label: operationLabel(entry.op), initiator: initiatorOf(entry.op), actor: entry.definition.actor || 'model',
      startedAt: entry.startedAt, endedAt: entry.finished ? entry.endedAt : null, ...result, ...(entry.error ? { error: entry.error } : {}),
      queued: result.status === 'queued', queuePosition: queue.position(entry.currentTaskId),
      tasks: tasks.map(({ definition, operation, params, plan, ...task }) => ({ ...task, operationId: task.operationId || entry.id, status: deriveTaskStatus(task.nodes), nodes: structuredClone(task.nodes) })),
      ...(entry.result || {}), result: entry.result, trace: entry.trace }
  }
  const find = id => entries.get(id) || [...entries.values()].find(entry => entry.tasks.some(task => task.id === id))
  const owned = (entry, sessionId) => { if (!entry || (entry.op.sessionId ?? null) !== (sessionId ?? null)) throw Object.assign(new Error('操作不存在或不属于当前会话'), { status: 404 }); return entry }
  const persist = async (entry, task, error, cancelled = false) => {
    let current = recorded(entry.op) ? await recordStore(home, entry.op.projectId).read('tasks', task.id) : task
    if (current.endedAt) { Object.assign(task, current); return current }
    const nodes = structuredClone(current.nodes)
    if (cancelled) {
      for (const node of nodes) if (['pending', 'running', 'waiting'].includes(node.status)) Object.assign(node, { status: StepStatus.CANCELLED, endedAt: now(), error: error?.message || '前序任务未完成，已停止' })
    } else {
      for (const node of nodes) if (node.status === StepStatus.RUNNING && !error) Object.assign(node, { status: StepStatus.COMPLETED, endedAt: now() })
      finalizeNodes(nodes, error, entry.controller.signal)
    }
    current = { ...current, nodes, status: deriveTaskStatus(nodes), endedAt: now(), error: nodes.find(node => node.error)?.error || error?.message || null }
    if (recorded(entry.op)) await recordStore(home, entry.op.projectId).update('tasks', task.id, current)
    liveTasks.delete(task.id); Object.assign(task, current)
    notifyProject(home, entry.op.projectId)
    return current
  }
  const log = (entry, message, failed = false) => { try { insertSessionLog(entry.session, message, failed, `日志-${operationLabel(entry.op)}`) } catch {} }
  const waitFor = async (entry, signal) => {
    signal?.throwIfAborted()
    let timer, abort
    try { await Promise.race([entry.done, new Promise((resolve, reject) => { timer = setTimeout(resolve, 25000); abort = () => reject(signal.reason); signal?.addEventListener('abort', abort, { once: true }) })]) }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    start(op, session, deps = {}) {
      const definition = validateOperation(op), id = randomUUID(), controller = new AbortController()
      const release = occupy(home, op, { id, label: operationLabel(op) })
      const abort = () => controller.abort(deps.signal.reason)
      if (deps.signal?.aborted) abort()
      else deps.signal?.addEventListener('abort', abort, { once: true })
      const entry = { id, op, definition, session, controller, startedAt: now(), tasks: [{ type: 'save', label: definition.label, nodes: [createNode({ kind: 'execute' }, definition.actor || 'model')] }], trace: [], result: {}, finished: false }
      entries.set(id, entry)
      let readyResolve, readyReject
      entry.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
      entry.ready.catch(() => {})
      entry.done = runWithSessionLog(session, async () => {
        try {
          const admitted = admission.then(async () => { controller.signal.throwIfAborted(); return prepareOperation(home, op, id) })
          admission = admitted.catch(() => {})
          const reviewStore = projectStore(home)
          let groupReview
          entry.tasks = await admitted
          readyResolve({ alreadyCompleted: entry.tasks.length === 0 })
          if (!entry.tasks.length) Object.assign(entry.result, { alreadyCompleted: true, status: 'completed', reviewPassed: true })
          if (op.action === 'seconds' && !op.track && (op.mode === 'modify' || op.generationMode === 'modify')) { const root = await reviewStore.read(op.projectId); groupReview = root.episodes.find(item => item.id === op.episodeId)?.shots.seconds.review }
          for (const task of entry.tasks) {
            controller.signal.throwIfAborted()
            entry.currentTaskId = task.id
            const job = async () => {
              controller.signal.throwIfAborted()
              if (recorded(op)) task.nodes = (await beginTask(home, op, task.id, task.plan, { ...task, operationId: id })).nodes
              else { task.nodes = task.plan.map(node => createNode(node, task.actor)); Object.assign(task.nodes[0], { status: StepStatus.RUNNING, startedAt: now() }) }
              if (recorded(op)) await refreshOperation(home, op.projectId, id)
              notifyProject(home, op.projectId)
              const trace = await execute(op, { ...deps, home, workspaceController: deps.workspaceController || workspaceController, session, signal: controller.signal, operationId: id, taskId: task.id, task, waitForBackground: true })
              entry.trace.push(...(trace || [])); Object.assign(entry.result, trace?.result || {})
              await persist(entry, task)
            }
            if (definition.kind === 'direct') await job()
            else await queue.run(task.queue, controller.signal, job, () => { log(entry, `${task.label} 排队中`); notifyProject(home, op.projectId) }, task.id)
            if (ended(deriveTaskStatus(task.nodes)) && deriveTaskStatus(task.nodes) !== 'completed') break
          }
          if (groupReview?.text && resultOf(tasksOf(entry)).status === 'completed') await reviewStore.save(op.projectId, root => { const review = root.episodes.find(item => item.id === op.episodeId).shots.seconds.review; if (review.revision === groupReview.revision && review.text === groupReview.text) { review.text = ''; review.revision++ }; return root })
        } catch (error) {
          readyReject(error)
          entry.failure = error; entry.error = error.message || '操作失败'
          const task = entry.tasks.find(task => task.id === entry.currentTaskId) || entry.tasks[0]
          if (task.id) await persist(entry, task, error).catch(() => {})
          else finalizeNodes(task.nodes, error, controller.signal)
          log(entry, `操作 ${id} 失败：${entry.error}`, true)
        } finally {
          for (const task of entry.tasks) if (task.id && !task.endedAt) await persist(entry, task, null, true).catch(error => { entry.error ||= error.message })
          if (recorded(op)) await refreshOperation(home, op.projectId, id, { ended: true, error: entry.error }).catch(() => {})
          deps.signal?.removeEventListener('abort', abort)
          entry.finished = true; entry.endedAt = now(); release(); notifyProject(home, op.projectId)
        }
        return snapshot(entry)
      })
      notifyProject(home, op.projectId)
      return { id, operationId: id, get taskId() { return entry.tasks[0]?.id }, get failure() { return entry.failure }, ready: entry.ready, done: entry.done }
    },
    list(projectId) { return [...entries.values()].filter(entry => !entry.finished && entry.op.projectId === projectId).map(snapshot) },
    current(projectId, episodeId) { return this.list(projectId).filter(operation => !episodeId || !operation.episodeId || operation.episodeId === episodeId) },
    async get(id, sessionId) {
      const entry = find(id)
      if (entry) { owned(entry, sessionId); if (entry.finished) await entry.done; return snapshot(entry) }
      for (const projectId of await projectIds(home)) {
        const store = recordStore(home, projectId)
        let operation
        try { operation = await store.read('operations', id) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        if ((operation.sessionId ?? null) !== (sessionId ?? null)) throw Object.assign(new Error('操作不属于当前会话'), { status: 404 })
        const tasks = await Promise.all(operation.taskIds.map(id => store.read('tasks', id)))
        return { ...operation, operationId: operation.id, ...resultOf(tasks), ...(tasks[0] ? await readTaskDraft(home, tasks[0]) : {}), tasks }
      }
      throw Object.assign(new Error('操作不存在'), { status: 404 })
    },
    async wait(id, sessionId, signal) { const entry = find(id); if (!entry) return this.get(id, sessionId); owned(entry, sessionId); await waitFor(entry, signal); return snapshot(entry) },
    async waitOccupant(id, signal, { projectId } = {}) { const entry = find(id); if (!entry || projectId && entry.op.projectId !== projectId) throw Object.assign(new Error('操作不存在'), { status: 404 }); await waitFor(entry, signal); return { ...snapshot(entry), occupant: true } },
    cancel(id, projectId, { sessionId } = {}) { const entry = find(id); if (!entry || entry.finished || entry.op.projectId !== projectId) throw Object.assign(new Error('操作已结束或不存在'), { status: 404 }); if (sessionId !== undefined) owned(entry, sessionId); entry.controller.abort(Object.assign(new Error('操作已停止'), { code: 'TASK_CANCELLED' })) },
    dispose() { for (const entry of entries.values()) if (!entry.finished) entry.controller.abort(Object.assign(new Error('服务已停止，操作已取消'), { code: 'TASK_CANCELLED' })) },
  }
}
