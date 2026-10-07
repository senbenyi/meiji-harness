import { randomUUID, createHash } from 'node:crypto'
import { executeLatestProjectCommand } from './commands.js'

// ProductionWorker leases durable tasks and executes only registered task kinds.
export class ProductionWorker {
  constructor({ projectService, handlers, prepareTask = async ({ task }) => task, owner = `worker-${randomUUID()}`, concurrency = 1, coordinatorKinds = [], leaseMs = 120000, pollMs = 1500, log = console }) {
    this.projects = projectService
    this.handlers = handlers
    this.prepareTask = prepareTask
    this.owner = owner
    this.concurrency = Math.max(1, Number(concurrency) || 1)
    this.leaseMs = Math.max(5000, Number(leaseMs) || 120000)
    this.pollMs = Math.max(250, Number(pollMs) || 1500)
    this.log = log
    this.running = new Set()
    this.runningKinds = new Map()
    this.coordinatorKinds = new Set(coordinatorKinds)
    if (this.coordinatorKinds.size && this.concurrency < 2) throw new Error('coordinator tasks require at least one reserved worker slot')
    this.timer = null
    this.stopped = true
    this.draining = false
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.timer = setInterval(() => void this.drain(), this.pollMs)
    this.timer.unref?.()
    void this.drain()
  }

  async stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await Promise.allSettled([...this.running])
  }

  async execute(projectId, type, payload, commandId) {
    return executeLatestProjectCommand(this.projects, { projectId, commandId, type, payload, actor: this.owner })
  }

  async drain() {
    if (this.stopped || this.draining) return
    this.draining = true
    try {
      const projects = await this.projects.listProjects()
      for (const project of projects) {
        for (const task of Object.values(project.productionTasks || {})) {
          if (this.running.size >= this.concurrency) return
          if (!this.handlers[task.kind]) continue
          if (this.coordinatorKinds.has(task.kind)) {
            if ([...this.runningKinds.values()].some((kind) => this.coordinatorKinds.has(kind))) continue
            if (this.running.size >= this.concurrency - 1) continue
          }
          const expired = task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= Date.now()
          if (task.status !== 'ready' && !(expired && ['leased', 'running'].includes(task.status))) continue
          const promise = this.runTask(project.id, task).finally(() => {
            this.running.delete(promise)
            this.runningKinds.delete(promise)
          })
          this.running.add(promise)
          this.runningKinds.set(promise, task.kind)
        }
      }
    } catch (error) {
      this.log.error?.('[dsh-short-video-studio] production worker scan failed:', error?.message || String(error))
    } finally {
      this.draining = false
    }
  }

  async runTask(projectId, candidate) {
    const attemptNumber = candidate.attemptNumber + 1
    const prefix = `production:${candidate.runId}:${candidate.id}:${attemptNumber}`
    let heartbeat = null
    try {
      await this.execute(projectId, 'leaseProductionTask', { taskId: candidate.id, owner: this.owner, leaseMs: this.leaseMs }, `${prefix}:lease`)
      await this.execute(projectId, 'startProductionTask', { taskId: candidate.id, owner: this.owner }, `${prefix}:start`)
      heartbeat = setInterval(() => {
        void this.execute(projectId, 'renewProductionTaskLease', { taskId: candidate.id, owner: this.owner, leaseMs: this.leaseMs }, `${prefix}:renew:${Date.now()}`)
          .catch((error) => this.log.error?.('[dsh-short-video-studio] production lease renewal failed:', error?.message || String(error)))
      }, Math.max(1000, Math.floor(this.leaseMs / 3)))
      heartbeat.unref?.()
      const project = await this.projects.getProject(projectId)
      const task = project.productionTasks[candidate.id]
      const checkpoint = async (name, value) => this.execute(projectId, 'checkpointProductionTask', {
        taskId: task.id, owner: this.owner, checkpoint: value,
      }, `${prefix}:checkpoint:${name}:${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)}`)
      const prepared = await this.prepareTask({ projectId, task, checkpoint })
      const output = await this.handlers[task.kind]({ projectId, task: prepared, owner: this.owner, checkpoint })
      await this.execute(projectId, 'completeProductionTask', {
        taskId: task.id, owner: this.owner, outputRef: output?.outputRef || null, summary: output?.summary || output || null,
      }, `${prefix}:complete`)
    } catch (error) {
      try {
        await this.execute(projectId, 'failProductionTask', { taskId: candidate.id, owner: this.owner, error: error?.message || String(error) }, `${prefix}:fail`)
      } catch (persistError) {
        this.log.error?.('[dsh-short-video-studio] production task failure persistence failed:', persistError?.message || String(persistError))
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }
  }
}
