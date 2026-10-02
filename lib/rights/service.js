import { randomUUID } from 'node:crypto'
import { assertRightsGate } from '../domain/policies.js'

export class RightsService {
  constructor(projectService) { this.projects = projectService }
  async record(projectId, payload) {
    const project = await this.projects.getProject(projectId)
    return this.projects.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'recordRights', payload, actor: 'rights' })
  }
  async check(projectId, action) { const project = await this.projects.getProject(projectId); assertRightsGate(project, action); return true }
}
