import { randomUUID } from 'node:crypto'
import { DomainNotFoundError, DomainValidationError } from './errors.js'
import { transition } from './state-machines.js'
import { assertProductionStages } from './policies.js'
import { productionProgress } from './read-models.js'

// Production task commands own the durable run graph and lease lifecycle.
const now = () => new Date().toISOString()
const taskIdOf = (value) => String(value.taskId || value.id || randomUUID())

function requiredRun(project, runId) {
  const run = project.productionRuns?.[runId]
  if (!run) throw new DomainNotFoundError(`production run not found: ${runId}`)
  return run
}

function requiredTask(project, taskId) {
  const task = project.productionTasks?.[taskId]
  if (!task) throw new DomainNotFoundError(`production task not found: ${taskId}`)
  return task
}

function dependenciesCompleted(project, task) {
  return task.dependencies.every((id) => project.productionTasks[id]?.status === 'completed')
}

function updateRun(project, runId) {
  const run = requiredRun(project, runId)
  const tasks = run.taskIds.map((id) => project.productionTasks[id]).filter(Boolean)
  const completedTaskIds = tasks.filter((task) => task.status === 'completed').map((task) => task.id)
  const failedTaskIds = tasks.filter((task) => task.status === 'failed').map((task) => task.id)
  const blockedTaskIds = tasks.filter((task) => task.status === 'blocked').map((task) => task.id)
  const completed = tasks.length > 0 && completedTaskIds.length === tasks.length
  const failed = tasks.length > 0 && tasks.every((task) => ['completed', 'failed', 'blocked'].includes(task.status)) && !completed
  project.productionRuns[runId] = {
    ...run,
    status: completed ? 'completed' : failed ? 'failed' : 'active',
    completedTaskIds,
    failedTaskIds: [...failedTaskIds, ...blockedTaskIds],
    completedAt: completed || failed ? (run.completedAt || now()) : null,
    updatedAt: now(),
  }
}

function promoteDependents(project, runId) {
  // Iterate in dependency order until failures have reached every downstream task.
  let changed
  do {
    changed = false
    for (const task of Object.values(project.productionTasks)) {
      if (task.runId !== runId || task.status !== 'pending') continue
      const dependencies = task.dependencies.map((id) => project.productionTasks[id]).filter(Boolean)
      if (dependencies.some((dependency) => ['failed', 'blocked'].includes(dependency.status))) {
        project.productionTasks[task.id] = transition(task, 'productionTask', 'blocked', { error: 'dependency failed' })
        changed = true
      } else if (dependenciesCompleted(project, task)) {
        project.productionTasks[task.id] = transition(task, 'productionTask', 'ready')
        changed = true
      }
    }
  } while (changed)
}

function assertOwner(task, owner) {
  if (!owner || task.owner !== owner) throw new DomainValidationError(`production task lease owner mismatch: ${task.id}`)
}

function assertAcyclic(project, taskIds) {
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visiting.has(id)) throw new DomainValidationError(`production task dependency cycle: ${id}`)
    if (visited.has(id) || !taskIds.includes(id)) return
    visiting.add(id)
    for (const dependency of project.productionTasks[id].dependencies) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of taskIds) visit(id)
}

export const productionCommandHandlers = {
  createProductionRun(project, payload) {
    const runId = String(payload.runId || randomUUID())
    if (project.productionRuns[runId]) throw new DomainValidationError(`production run already exists: ${runId}`)
    if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) throw new DomainValidationError('production tasks must be a non-empty array')
    const timestamp = now()
    const ids = payload.tasks.map(taskIdOf)
    if (new Set(ids).size !== ids.length) throw new DomainValidationError('production task ids must be unique')
    const known = new Set([...Object.keys(project.productionTasks), ...ids])
    if (ids.some((id) => project.productionTasks[id])) throw new DomainValidationError('production task id already exists in project')
    for (let index = 0; index < payload.tasks.length; index += 1) {
      const input = payload.tasks[index]
      const dependencies = [...new Set((input.dependencies || []).map(String))]
      if (dependencies.some((id) => !known.has(id))) throw new DomainValidationError(`production task dependency not found: ${ids[index]}`)
      if (dependencies.includes(ids[index])) throw new DomainValidationError(`production task cannot depend on itself: ${ids[index]}`)
      project.productionTasks[ids[index]] = {
        id: ids[index], runId, kind: String(input.kind || ''), scopeId: input.scopeId ? String(input.scopeId) : null,
        dependencies, status: dependencies.length ? 'pending' : 'ready', input: input.input || {}, inputRef: input.inputRef || null,
        outputRef: null, summary: null, error: null, owner: null, leaseExpiresAt: null, attemptNumber: 0,
        checkpoint: {},
        stableCommandId: null, createdAt: timestamp, updatedAt: timestamp,
      }
      if (!project.productionTasks[ids[index]].kind) throw new DomainValidationError(`production task kind required: ${ids[index]}`)
    }
    assertAcyclic(project, ids)
    project.productionRuns[runId] = {
      id: runId, sourceId: payload.sourceId || null, mode: payload.mode || 'fast', status: 'active',
      taskIds: ids, completedTaskIds: [], failedTaskIds: [], createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    }
    promoteDependents(project, runId)
    if (project.status === 'draft') Object.assign(project, transition(project, 'project', 'active'))
    return { runId, taskIds: ids }
  },

  leaseProductionTask(project, payload) {
    let task = requiredTask(project, payload.taskId)
    const expired = task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= Date.now()
    if (expired && ['leased', 'running'].includes(task.status)) task = transition(task, 'productionTask', 'ready', { owner: null, leaseExpiresAt: null })
    if (task.status !== 'ready') throw new DomainValidationError(`production task is not ready: ${task.id}`)
    const owner = String(payload.owner || '')
    if (!owner) throw new DomainValidationError('production task lease owner required')
    const attemptNumber = task.attemptNumber + 1
    const leaseMs = Math.max(1000, Number(payload.leaseMs) || 120000)
    project.productionTasks[task.id] = transition(task, 'productionTask', 'leased', {
      owner, attemptNumber, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      stableCommandId: `production:${task.runId}:${task.id}:${attemptNumber}`,
    })
    return { taskId: task.id, attemptNumber, stableCommandId: project.productionTasks[task.id].stableCommandId }
  },

  renewProductionTaskLease(project, payload) {
    const task = requiredTask(project, payload.taskId)
    assertOwner(task, payload.owner)
    if (!['leased', 'running'].includes(task.status)) throw new DomainValidationError(`production task lease cannot be renewed: ${task.id}`)
    const leaseMs = Math.max(1000, Number(payload.leaseMs) || 120000)
    project.productionTasks[task.id] = { ...task, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), updatedAt: now() }
    return { taskId: task.id, leaseExpiresAt: project.productionTasks[task.id].leaseExpiresAt }
  },

  checkpointProductionTask(project, payload) {
    const task = requiredTask(project, payload.taskId)
    assertOwner(task, payload.owner)
    if (task.status !== 'running') throw new DomainValidationError(`production task is not running: ${task.id}`)
    project.productionTasks[task.id] = { ...task, checkpoint: { ...(task.checkpoint || {}), ...(payload.checkpoint || {}) }, updatedAt: now() }
    return { taskId: task.id }
  },

  startProductionTask(project, payload) {
    const task = requiredTask(project, payload.taskId)
    assertOwner(task, payload.owner)
    if (task.kind === 'render-shot') assertProductionStages(project, task.scopeId)
    if (task.kind === 'render-storyboard') assertProductionStages(project, task.scopeId, { storyboard: false })
    project.productionTasks[task.id] = transition(task, 'productionTask', 'running')
    return { taskId: task.id }
  },

  completeProductionTask(project, payload) {
    const task = requiredTask(project, payload.taskId)
    assertOwner(task, payload.owner)
    project.productionTasks[task.id] = transition(task, 'productionTask', 'completed', {
      outputRef: payload.outputRef || null, summary: payload.summary || null, error: null,
      owner: null, leaseExpiresAt: null, completedAt: now(),
    })
    promoteDependents(project, task.runId)
    updateRun(project, task.runId)
    return { taskId: task.id, runId: task.runId }
  },

  recordProductionTaskResult(project, payload) {
    let task = requiredTask(project, payload.taskId)
    if (['render-reference', 'render-storyboard', 'render-shot', 'concat-video', 'deliver-drama'].includes(task.kind)) throw new DomainValidationError('media task results must be recorded by the production worker')
    if (task.status !== 'ready') throw new DomainValidationError(`production task is not ready: ${task.id}`)
    if (task.kind === 'render-shot') assertProductionStages(project, task.scopeId)
    if (task.kind === 'render-storyboard') assertProductionStages(project, task.scopeId, { storyboard: false })
    task = transition(task, 'productionTask', 'leased', { owner: 'agent', leaseExpiresAt: null, attemptNumber: task.attemptNumber + 1 })
    task = transition(task, 'productionTask', 'running')
    project.productionTasks[task.id] = transition(task, 'productionTask', 'completed', {
      outputRef: payload.outputRef || null, summary: payload.summary || null, owner: null, completedAt: now(),
    })
    promoteDependents(project, task.runId)
    updateRun(project, task.runId)
    return { taskId: task.id, runId: task.runId }
  },

  failProductionTask(project, payload) {
    const task = requiredTask(project, payload.taskId)
    assertOwner(task, payload.owner)
    project.productionTasks[task.id] = transition(task, 'productionTask', 'failed', {
      error: String(payload.error || 'unknown'), owner: null, leaseExpiresAt: null,
    })
    promoteDependents(project, task.runId)
    updateRun(project, task.runId)
    return { taskId: task.id, runId: task.runId }
  },

  resumeProductionRun(project, payload) {
    const run = requiredRun(project, payload.runId)
    const selected = Array.isArray(payload.taskIds) && payload.taskIds.length ? new Set(payload.taskIds.map(String)) : null
    const resumed = []
    for (const id of run.taskIds) {
      const task = project.productionTasks[id]
      if (!task || (selected && !selected.has(id)) || !['failed', 'blocked', 'leased', 'running'].includes(task.status)) continue
      if (['leased', 'running'].includes(task.status) && Date.parse(task.leaseExpiresAt) > Date.now()) continue
      const status = dependenciesCompleted(project, task) ? 'ready' : 'pending'
      const base = transition(task, 'productionTask', 'ready', { owner: null, leaseExpiresAt: null, error: null, lastError: task.error || task.lastError || null })
      project.productionTasks[id] = status === 'ready'
        ? base
        : { ...base, status: 'pending', updatedAt: now() }
      resumed.push(id)
    }
    promoteDependents(project, run.id)
    updateRun(project, run.id)
    return { runId: run.id, resumedTaskIds: resumed }
  },
}

export function productionStatus(project, runId) {
  const run = requiredRun(project, runId)
  const tasks = run.taskIds.map((id) => project.productionTasks[id]).filter(Boolean)
  const counts = tasks.reduce((result, task) => ({ ...result, [task.status]: (result[task.status] || 0) + 1 }), {})
  return {
    production: productionProgress(project),
    run: { ...structuredClone(run), counts },
    tasks: tasks.map(({ input, ...task }) => ({ ...structuredClone(task), hasInlineInput: Boolean(input && Object.keys(input).length) })),
  }
}
