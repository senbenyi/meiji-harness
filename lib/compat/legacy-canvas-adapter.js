import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canvasReadModel } from '../domain/read-models.js'
import { isRevisionConflict } from '../production/commands.js'

export function canvasBindingKey(root, sessionId) {
  return `canvas-${createHash('sha256').update(`${root}\0${sessionId}`).digest('hex')}`
}

function emptyCanvas(sessionId) {
  return {
    schemaVersion: 1,
    sessionId,
    settings: { aspectRatio: '16:9', duration: '', audioMode: 'native' },
    nodes: [],
  }
}

export function upsertCanvasNode(canvas, node) {
  const next = structuredClone(canvas)
  const index = next.nodes.findIndex((item) => item.id === node.id)
  const order = index >= 0
    ? next.nodes[index].order
    : next.nodes.reduce((max, item) => Math.max(max, Number(item.order) || 0), -1) + 1
  const value = { ...node, order, createdAt: index >= 0 ? next.nodes[index].createdAt : node.createdAt }
  if (index >= 0) next.nodes[index] = value
  else next.nodes.push(value)
  return next
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
    const key = canvasBindingKey(root, sessionId)
    const binding = await this.projects.resolveBinding(key)
    if (binding) return this.projects.getProject(binding.projectId)
    const legacy = await readLegacySource(root, sessionId)
    const created = await this.projects.createProject({
      commandId: randomUUID(),
      payload: { title: legacy.settings?.title || '未命名短剧项目' },
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

  async bind(root, sessionId, projectId, source = 'project-create') {
    return this.projects.bind(canvasBindingKey(root, sessionId), projectId, source, { replace: true })
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
      payload: { canvas: { ...canvas, projectId: undefined, revision: undefined, nodes: canvas.nodes.filter((node) => !node.domainProjection) } },
      actor: 'legacy-canvas-adapter',
    })
    return canvasReadModel(result.project)
  }

  async upsertNode(root, sessionId, node) {
    let lastError
    const commandId = randomUUID()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const project = await this.projectFor(root, sessionId)
      const canvas = upsertCanvasNode(project.legacyCanvas || emptyCanvas(sessionId), node)
      try {
        const result = await this.projects.execute({
          projectId: project.id,
          commandId,
          expectedRevision: project.revision,
          type: 'replaceLegacyCanvas',
          payload: { canvas },
          actor: 'legacy-canvas-adapter',
        })
        return canvasReadModel(result.project)
      } catch (error) {
        if (!isRevisionConflict(error)) throw error
        lastError = error
      }
    }
    throw lastError
  }
}
