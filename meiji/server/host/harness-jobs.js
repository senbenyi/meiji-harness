import { imageItems } from '../../shared/library-images.js'
import { pictureOf } from '../../shared/drama-model.js'
import { scriptBlockers } from '../../shared/script-assembly.js'

const terminal = status => !['queued', 'running'].includes(status)
const unavailable = reason => Object.assign(new Error(`后台任务登记失败：${reason.message}`), { status: 409, code: 'JOBS_UNAVAILABLE', cause: reason })
const jobLabel = op => op.origin === 'panel' ? `面板单次操作 ${op.action}（完成后汇报并结束，不规划后续）` : op.action
export function operationResult(operation) {
  const data = operation.result || {}
  return { operationId: operation.operationId || operation.id, projectId: operation.projectId, episodeId: operation.episodeId || data.episodeId || null,
    step: operation.parameters?.step || data.step || null, stepCompleted: ['completed', 'review_failed'].includes(operation.status),
    action: operation.action, initiator: operation.initiator, status: operation.status, reviewPassed: operation.reviewPassed ?? null, failures: operation.failures || [],
    ...(operation.initiator === 'panel' && terminal(operation.status) ? { nextAction: 'end' } : {}),
    ...(operation.goalRef ? { goalId: operation.goalRef.id } : {}),
    ...(operation.error ? { error: operation.error } : {}),
    ...(operation.initiator !== 'panel' && !operation.parameters?.step && operation.tasks?.some(task => task.type === 'project-summary' && ['failed', 'review_failed'].includes(task.status)) ? { retryable: true } : {}),
    ...Object.fromEntries(['scriptRevision', 'pendingConfirm', 'pendingProposal', 'scriptSyncOperationId', 'scriptSyncError'].filter(key => data[key] !== undefined).map(key => [key, data[key]])) }
}
const outcome = result => ({ status: result.status === 'cancelled' ? 'killed' : result.status === 'failed' || result.status === 'review_failed' && result.step !== 'review' ? 'failed' : 'completed', result: JSON.stringify(result) })

export function createHarnessJobs({ home, manager, registry, subscribeProject, readProject, logger = { warn() {} } }) {
  const observers = new Map()
  const metadata = new Map(), observerIds = new Map()
  // 同一个观察生命周期负责订阅、串行检查、结算和脱离，不执行业务任务。
  function observe(job, { projectId, operationId, kind, source = 'session', check, completion, onEnded, cancelOperation = false }) {
    let operationFinished = !operationId
    let goal
    let stopped = false, resolve, checking = false, again = false
    const done = new Promise(accept => { resolve = accept }), completedTasks = new Set()
    const cleanup = subscribeProject(home, projectId, () => { void inspect() })
    const settle = value => { if (stopped) return; stopped = true; cleanup(); observers.delete(job.id); resolve(value) }
    async function inspect() {
      if (stopped) return
      if (checking) { again = true; return }
      checking = true
      try {
        do {
          again = false
          const value = await check()
          if (stopped) return
          if (kind === 'meiji') {
            const ended = (value.tasks || []).filter(task => terminal(task.status))
            const current = (value.tasks || []).find(task => !terminal(task.status))
            job.updateProgress(`${ended.length}/${value.tasks?.length || 0} ${current?.label || value.label || ''}`)
            for (const task of ended) if (!completedTasks.has(task.id)) { completedTasks.add(task.id); job.append(`${task.label || task.type}：${task.status}\n`) }
          }
          const result = operationFinished ? completion(value, goal) : null
          if (result) {
            settle(kind === 'meiji' ? outcome(result) : { status: 'completed', result: JSON.stringify(result) })
          }
        } while (again && !stopped)
      } catch (error) { settle({ status: 'failed', detail: error.message, result: JSON.stringify({ error: error.message }) }) }
      finally { checking = false }
    }
    if (operationId) manager.whenEnded(operationId, { projectId }).then(async value => { goal = await onEnded?.(value); operationFinished = true; return inspect() }).catch(error => settle({ status: 'failed', detail: error.message }))
    void inspect()
    metadata.set(job.id, { source, operationId, projectId, kind })
    const hooks = { done, cancel(reason) {
      if (stopped) return
      if (cancelOperation && !['owner disposed', 'jobs service disposed'].includes(reason)) {
        try { manager.cancel(operationId, projectId) } catch (error) { if (error.status !== 404) logger.warn(error.message) }
      }
      settle({ status: 'killed', detail: reason || '已停止观察' })
    } }
    observers.set(job.id, hooks)
    return hooks
  }
  function register(spec) {
    if (!registry?.start) throw unavailable(new Error('Harness jobs 服务不可用'))
    let entered = false
    try { return registry.start({ outputLimitBytes: 16384, ...spec, run: job => { entered = true; return spec.run(job) } }) }
    catch (error) { if (entered) throw error; throw unavailable(error) }
  }
  const operationObserver = (job, id, op, onEnded) => observe(job, { kind: 'meiji', source: op.origin || 'session', projectId: op.projectId, operationId: id, onEnded, cancelOperation: true,
    check: async () => manager.track(id, { projectId: op.projectId }).snapshot(), completion: (value, goal) => {
      if (!terminal(value.status)) return null
      const result = operationResult(value)
      if (goal) result.goal = { id: goal.id, phase: goal.phase, activation: goal.activation }
      if (result.status === 'completed' && op.origin === 'session') {
        try {
          if (result.pendingProposal) adapter.waitScript(op.projectId, op.sessionId)
          if (result.pendingConfirm && op.episodeId) adapter.waitImages(op.projectId, op.episodeId, op.itemIds || (op.itemId ? [op.itemId] : undefined), op.sessionId)
        } catch (error) { logger.warn(`业务已完成，等待任务未登记：${error.message}`) }
      }
      return result
    } })
  async function collect(id, owner) {
    await registry.wait(id, 5000, owner)
    const result = registry.read(id, owner)
    registry.remove(id, owner); metadata.delete(id)
    return result.result ? JSON.parse(result.result) : null
  }
  const adapter = {
    async start(op, session, deps = {}, onEnded) {
      let started
      const jobId = register({ kind: 'meiji', label: jobLabel(op), owner: op.sessionId,
        run(job) { started = manager.start(op, session, deps); return operationObserver(job, started.id, op, onEnded) } })
      try {
        const ready = await started.ready
        if (ready.alreadyCompleted) return { ...await collect(jobId, op.sessionId), alreadyCompleted: true }
        return { status: 'running', jobId, operationId: started.id, projectId: op.projectId, episodeId: op.episodeId || null }
      } catch (error) { await started.done; await collect(jobId, op.sessionId).catch(() => {}); throw error }
    },
    bind(id, op) {
      if (observerIds.has(id)) return observerIds.get(id)
      const jobId = register({ kind: 'meiji', label: jobLabel(op), owner: op.sessionId, run: job => operationObserver(job, id, op) })
      observerIds.set(id, jobId); return jobId
    },
    waitBusy(projectId, operationId, sessionId) {
      const jobId = register({ kind: 'meiji-wait', label: '等待项目占用结束', owner: sessionId,
        run: job => observe(job, { kind: 'meiji-wait', projectId, operationId, check: async () => manager.track(operationId, { projectId }).snapshot(),
          completion: value => terminal(value.status) ? { occupantOperationId: operationId, occupantStatus: value.status, message: '占用已结束，请重新发起原操作' } : null }) })
      return { status: 'running', jobId, occupantOperationId: operationId, projectId }
    },
    waitScript(projectId, sessionId) {
      let pending
      const jobId = register({ kind: 'meiji-script', label: '等待剧本处理', owner: sessionId,
        run: job => observe(job, { kind: 'meiji-script', projectId, check: async () => readProject(projectId), completion: project => {
          pending ||= scriptBlockers(project)
          return scriptBlockers(project).length ? null : { scriptRevision: project.scriptRevision, resolved: pending, message: '剧本待处理依据已消除，请重新发起原操作' }
        } }) })
      return { status: 'running', jobId, projectId }
    },
    waitImages(projectId, episodeId, itemIds, sessionId) {
      const selected = itemIds?.length ? new Set(itemIds) : null
      const jobId = register({ kind: 'meiji-images', label: '等待图片确认', owner: sessionId,
        run: job => observe(job, { kind: 'meiji-images', projectId, check: async () => readProject(projectId), completion: project => {
          const episode = project.episodes.find(item => item.id === episodeId)
          if (!episode) throw new Error('目标剧集已删除')
          const items = imageItems(project, episode, selected ? [...selected] : undefined).map(({ itemId, name, ready }) => ({ itemId, name, ready }))
          return items.every(item => item.ready) ? { items } : null
        } }) })
      return { status: 'running', jobId, projectId, episodeId }
    },
    guard(exec) {
      if (exec.name !== 'job_kill') return
      const info = metadata.get(exec.arguments?.job_id)
      if (info?.source === 'panel') return '面板发起的任务请由用户在面板停止'
    },
    dispose() { detach(); for (const hooks of observers.values()) hooks.cancel('owner disposed'); observers.clear(); metadata.clear(); observerIds.clear() },
  }
  const detach = manager.onStarted(({ id, op }) => {
    if (op.followUpOf && op.action === 'script-sync' && op.origin === 'session' && op.sessionId) {
      try { adapter.bind(id, op) } catch (error) { logger.warn(`自动回写继续执行，观察任务未登记：${error.message}`) }
    }
  })
  return adapter
}
