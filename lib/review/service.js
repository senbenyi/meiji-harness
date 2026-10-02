import { randomUUID } from 'node:crypto'

export class ReviewService {
  constructor(projectService) { this.projects = projectService }
  async command(projectId, type, payload, actor) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type, payload, actor })
  }
  create(projectId, payload) { return this.command(projectId, 'createReviewTask', payload, 'review') }
  recordAutomatedCheck(projectId, payload) { return this.command(projectId, 'recordAutomatedCheck', payload, 'automated-check') }
  decide(projectId, payload) { return this.command(projectId, 'recordReviewDecision', payload, payload.answerer || 'user') }
}
