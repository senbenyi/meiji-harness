import { randomUUID } from 'node:crypto'

export class DeliveryService {
  constructor(projectService) { this.projects = projectService }
  async plan(projectId, timelineId, preset) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'planDeliverable', payload: { timelineId, preset }, actor: 'delivery' })
  }
  async complete(projectId, payload) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'recordDeliverable', payload, actor: 'delivery' })
  }
}
