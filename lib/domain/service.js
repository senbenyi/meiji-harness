import { createHash, randomUUID } from 'node:crypto'
import { applyCommand } from './commands/index.js'
import { createProjectAggregate, parseProject, studioDomainSpec } from './spec.js'
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from './errors.js'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function payloadHash(type, payload) {
  return createHash('sha256').update(canonical({ type, payload })).digest('hex')
}

export class MemoryProjectRepository {
  constructor() {
    this.projects = new Map()
    this.bindings = new Map()
    this.chains = new Map()
  }

  async open() { return this }
  async close() {}
  get(projectId) { return this.projects.get(projectId) }
  list() { return [...this.projects.values()] }
  async put(project) { this.projects.set(project.id, structuredClone(parseProject(project))) }
  async update(projectId, fn) {
    const previous = this.chains.get(projectId) || Promise.resolve()
    let result
    const next = previous.then(() => {
      const current = this.projects.get(projectId)
      if (!current) throw new DomainNotFoundError(`project not found: ${projectId}`)
      result = parseProject(fn(structuredClone(current)))
      this.projects.set(projectId, structuredClone(result))
    })
    const settled = next.catch(() => {})
    this.chains.set(projectId, settled)
    await next
    if (this.chains.get(projectId) === settled) this.chains.delete(projectId)
    return structuredClone(result)
  }
  getBinding(key) { return this.bindings.get(key) }
  async putBinding(binding) { this.bindings.set(binding.bindingKey, structuredClone(binding)) }
}

export class HarnessProjectRepository {
  constructor(ctx) {
    this.ctx = ctx
    this.domain = null
    this.opening = null
  }

  async open() {
    if (this.domain) return this
    if (!this.opening) {
      this.opening = (async () => {
        const facility = this.ctx.storage?.domain
        if (!facility?.open) throw new Error('Harness Domain Storage is not mounted at ctx.storage.domain')
        this.domain = await facility.open(studioDomainSpec)
        return this
      })()
    }
    return this.opening
  }

  async ready() { await this.open(); return this.domain }
  async close() { if (this.domain) await this.domain.close(); this.domain = null }
  async get(projectId) { return (await this.ready()).table('projects').get(projectId) }
  async list() { return [...(await this.ready()).table('projects').entries()].map(([, value]) => value) }
  async put(project) { await (await this.ready()).table('projects').put(project.id, parseProject(project)) }
  async update(projectId, fn) { return (await this.ready()).table('projects').update(projectId, fn) }
  async getBinding(key) { return (await this.ready()).table('bindings').get(key) }
  async putBinding(binding) { await (await this.ready()).table('bindings').put(binding.bindingKey, binding) }
}

export class ProjectService {
  constructor(repository) {
    this.repository = repository
  }

  async open() { await this.repository.open(); return this }
  async close() { await this.repository.close() }
  async getProject(projectId) {
    const project = await this.repository.get(projectId)
    if (!project) throw new DomainNotFoundError(`project not found: ${projectId}`)
    return structuredClone(project)
  }
  async listProjects() { return (await this.repository.list()).map((project) => structuredClone(project)) }

  async createProject({ projectId = randomUUID(), commandId = randomUUID(), payload = {} } = {}) {
    const existing = await this.repository.get(projectId)
    if (existing) {
      const result = existing.commandResults?.[commandId]
      if (result) return { project: structuredClone(existing), result }
      throw new DomainConflictError(`project already exists: ${projectId}`)
    }
    const project = createProjectAggregate({ id: projectId, ...payload })
    const hash = payloadHash('createProject', payload)
    project.revision = 1
    project.commandResults[commandId] = { commandId, payloadHash: hash, result: 'ok', revision: 1, timestamp: new Date().toISOString(), output: { projectId } }
    await this.repository.put(project)
    return { project: structuredClone(project), result: project.commandResults[commandId] }
  }

  async execute({ projectId, commandId, expectedRevision, type, payload = {}, actor = 'agent' }) {
    if (!projectId || !commandId || !type) throw new DomainValidationError('projectId, commandId and type are required')
    const hash = payloadHash(type, payload)
    let output
    const project = await this.repository.update(projectId, (current) => {
      const previous = current.commandResults?.[commandId]
      if (previous) {
        if (previous.payloadHash !== hash) throw new DomainConflictError(`commandId reused with different payload: ${commandId}`)
        output = previous.output
        return current
      }
      if (!Number.isInteger(expectedRevision) || current.revision !== expectedRevision) {
        throw new DomainConflictError(`revision conflict for ${projectId}`, { expectedRevision, actualRevision: current.revision })
      }
      const next = structuredClone(current)
      output = applyCommand(next, type, payload, { commandId, actor })
      next.revision += 1
      next.updatedAt = new Date().toISOString()
      next.commandResults[commandId] = {
        commandId, payloadHash: hash, result: 'ok', revision: next.revision,
        timestamp: next.updatedAt, actor, output,
      }
      return parseProject(next)
    })
    return { project: structuredClone(project), result: project.commandResults[commandId], output }
  }

  async bind(bindingKey, projectId, source = 'explicit') {
    await this.getProject(projectId)
    const existing = await this.repository.getBinding(bindingKey)
    if (existing && existing.projectId !== projectId) throw new DomainConflictError(`binding already points to another project: ${bindingKey}`)
    const binding = { bindingKey, projectId, source, updatedAt: new Date().toISOString() }
    await this.repository.putBinding(binding)
    return binding
  }

  async resolveBinding(bindingKey) {
    return this.repository.getBinding(bindingKey)
  }
}

export function createHarnessProjectService(ctx) {
  return new ProjectService(new HarnessProjectRepository(ctx))
}

export { OutboxDispatcher } from './outbox.js'
