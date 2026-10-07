import { randomUUID } from 'node:crypto'
import { DomainConflictError, DomainValidationError } from '../domain/errors.js'
import { executeLatestProjectCommand } from './commands.js'

const messageOf = (error) => String(error?.message || error || 'unknown production failure')

export function classifyDagFailure(error, stage) {
  if (error?.failureClass) {
    return { failureClass: String(error.failureClass), retryable: error.retryable === true }
  }
  if (stage === 'validate') return { failureClass: 'invalid-output', retryable: error?.retryable !== false }
  if (stage === 'materialize') {
    const retryable = error?.retryable === true || error instanceof DomainConflictError
    return { failureClass: 'domain-commit', retryable }
  }

  const text = messageOf(error).toLowerCase()
  if (/timeout|timed out/.test(text)) return { failureClass: 'timeout', retryable: true }
  if (/structured output/.test(text)) return { failureClass: 'no-structured-output', retryable: true }
  if (error?.retryable === true || /network|econn|rate.?limit|429/.test(text)) {
    return { failureClass: 'retryable-error', retryable: true }
  }
  return { failureClass: 'non-retryable', retryable: false }
}

// Executes one leased DAG node. Dependencies and readiness remain owned by the
// production task commands; this class owns only the durable node boundary.
export class DurableDagExecutor {
  constructor({ projectService, generate, validate, materialize, owner = `dag-${randomUUID()}`, leaseMs = 120000 }) {
    if (!projectService || typeof generate !== 'function' || typeof validate !== 'function' || typeof materialize !== 'function') {
      throw new TypeError('projectService, generate, validate and materialize are required')
    }
    this.projects = projectService
    this.generate = generate
    this.validate = validate
    this.materialize = materialize
    this.owner = owner
    this.leaseMs = Math.max(1000, Number(leaseMs) || 120000)
  }

  async command(projectId, commandId, type, payload) {
    return executeLatestProjectCommand(this.projects, { projectId, commandId, type, payload, actor: this.owner })
  }

  async runTask(projectId, taskId) {
    const initialProject = await this.projects.getProject(projectId)
    const initialTask = initialProject.productionTasks?.[taskId]
    if (!initialTask) throw new DomainValidationError(`production task not found: ${taskId}`)
    const attempt = initialTask.attemptNumber + 1
    const attemptCommandId = `production:${initialTask.runId}:${taskId}:${attempt}`
    const materializeCommandId = `production:${initialTask.runId}:${taskId}:materialize`
    let stage = 'lease'
    let started = false

    try {
      await this.command(projectId, `${attemptCommandId}:lease`, 'leaseProductionTask', {
        taskId, owner: this.owner, leaseMs: this.leaseMs,
      })
      stage = 'start'
      await this.command(projectId, `${attemptCommandId}:start`, 'startProductionTask', { taskId, owner: this.owner })
      started = true

      const runningProject = await this.projects.getProject(projectId)
      const task = runningProject.productionTasks[taskId]
      let checkpoint = task.checkpoint || {}
      let candidate = checkpoint.candidate

      if (!['validated', 'materialized'].includes(checkpoint.stage)) {
        stage = 'generate'
        candidate = await this.generate({ projectId, project: runningProject, task })
        stage = 'validate'
        const normalized = await this.validate(candidate, { projectId, project: runningProject, task })
        if (normalized !== undefined) candidate = normalized
        checkpoint = { stage: 'validated', candidate }
        stage = 'checkpoint'
        await this.command(projectId, `${attemptCommandId}:checkpoint:validated`, 'checkpointProductionTask', {
          taskId, owner: this.owner, checkpoint,
        })
      }

      let materializationRef = checkpoint.materializationRef
      if (checkpoint.stage !== 'materialized') {
        stage = 'materialize'
        const result = await this.materialize(candidate, {
          projectId, task, commit: task.input?.commit || null, commandId: materializeCommandId,
        })
        materializationRef = result?.materializationRef ?? result?.outputRef ?? result
        checkpoint = { stage: 'materialized', candidate, materializationRef, materializeCommandId }
        stage = 'checkpoint'
        await this.command(projectId, `${attemptCommandId}:checkpoint:materialized`, 'checkpointProductionTask', {
          taskId, owner: this.owner, checkpoint,
        })
      }

      stage = 'complete'
      await this.command(projectId, `${attemptCommandId}:complete`, 'completeProductionTask', {
        taskId, owner: this.owner, outputRef: materializationRef ?? null,
        summary: { materializeCommandId },
      })
      return { status: 'completed', taskId, materializationRef, materializeCommandId }
    } catch (error) {
      const failure = classifyDagFailure(error, stage)
      if (!started) throw error
      await this.command(projectId, `${attemptCommandId}:fail`, 'failProductionTask', {
        taskId, owner: this.owner, error: messageOf(error), ...failure,
      })
      return { status: 'failed', taskId, error: messageOf(error), ...failure }
    }
  }
}
