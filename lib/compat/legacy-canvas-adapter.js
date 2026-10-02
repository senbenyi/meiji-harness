import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canvasReadModel } from '../domain/read-models.js'

function bindingKey(root, sessionId) {
  return `canvas-${createHash('sha256').update(`${root}\0${sessionId}`).digest('hex')}`
}

function emptyCanvas(sessionId) {
  return {
    schemaVersion: 1,
    sessionId,
    settings: { aspectRatio: '16:9', duration: '', audioMode: 'silent' },
    nodes: [],
  }
}

async function readLegacySource(root, sessionId) {
  const file = join(root, 'canvas', sessionId, 'project.json')
  if (!existsSync(file)) return emptyCanvas(sessionId)
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) throw new Error(`legacy canvas is corrupt: ${file}`)
  return parsed
}

export class LegacyCanvasCommandAdapter {
  constructor(projectService) {
    this.projects = projectService
  }

  async projectFor(root, sessionId) {
    const key = bindingKey(root, sessionId)
    const binding = await this.projects.resolveBinding(key)
    if (binding) return this.projects.getProject(binding.projectId)
    const legacy = await readLegacySource(root, sessionId)
    const created = await this.projects.createProject({
      commandId: randomUUID(),
      payload: { title: legacy.settings?.title || `短剧项目 ${sessionId}` },
    })
    let project = created.project
    const imported = await this.projects.execute({
      projectId: project.id,
      commandId: randomUUID(),
      expectedRevision: project.revision,
      type: 'replaceLegacyCanvas',
      payload: { canvas: legacy },
      actor: 'legacy-migration',
    })
    project = imported.project
    await this.projects.bind(key, project.id, existsSync(join(root, 'canvas', sessionId, 'project.json')) ? 'legacy-import' : 'session')
    return project
  }

  async load(root, sessionId) {
    return canvasReadModel(await this.projectFor(root, sessionId))
  }

  async save(root, sessionId, canvas) {
    const project = await this.projectFor(root, sessionId)
    const result = await this.projects.execute({
      projectId: project.id,
      commandId: randomUUID(),
      expectedRevision: project.revision,
      type: 'replaceLegacyCanvas',
      payload: { canvas: { ...canvas, projectId: undefined, revision: undefined } },
      actor: 'legacy-canvas-adapter',
    })
    return canvasReadModel(result.project)
  }
}
