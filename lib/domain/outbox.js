import { randomUUID } from 'node:crypto'

export class OutboxDispatcher {
  constructor(projectService, handlers = {}, options = {}) {
    this.projectService = projectService
    this.handlers = handlers
    this.maxBatch = options.maxBatch || 20
  }

  async drainProject(projectId) {
    let project = await this.projectService.getProject(projectId)
    const events = Object.values(project.outboxEvents)
      .filter((event) => ['pending', 'retry_wait'].includes(event.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, this.maxBatch)
    const results = []
    for (const event of events) {
      const handler = this.handlers[event.type]
      if (!handler) continue
      project = await this.projectService.getProject(projectId)
      await this.projectService.execute({
        projectId, commandId: randomUUID(), expectedRevision: project.revision,
        type: 'markOutboxEvent', payload: { eventId: event.id, status: 'processing' }, actor: 'outbox',
      })
      try {
        const response = await handler(event)
        project = await this.projectService.getProject(projectId)
        await this.projectService.execute({
          projectId, commandId: randomUUID(), expectedRevision: project.revision,
          type: 'markOutboxEvent', payload: { eventId: event.id, status: 'delivered', externalRef: response?.externalRef || null }, actor: 'outbox',
        })
        results.push({ eventId: event.id, status: 'delivered' })
      } catch (error) {
        project = await this.projectService.getProject(projectId)
        const retryCount = event.retryCount + 1
        const status = retryCount >= event.maxRetries ? 'dead' : 'retry_wait'
        await this.projectService.execute({
          projectId, commandId: randomUUID(), expectedRevision: project.revision,
          type: 'markOutboxEvent', payload: { eventId: event.id, status, retryCount, error: error?.message || String(error) }, actor: 'outbox',
        })
        results.push({ eventId: event.id, status })
      }
    }
    return results
  }
}
