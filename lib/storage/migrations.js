import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function legacyProjectId(sourceRoot, sessionId) {
  return `legacy-${createHash('sha256').update(`${sourceRoot}\0${sessionId}`).digest('hex').slice(0, 20)}`
}

export async function importLegacyCanvas({ sourceRoot, sessionId, projectService, title }) {
  if (!sourceRoot || !sessionId) throw new Error('sourceRoot and sessionId are required')
  const source = join(sourceRoot, 'canvas', sessionId, 'project.json')
  const canvas = JSON.parse(await readFile(source, 'utf8'))
  if (!canvas || !Array.isArray(canvas.nodes)) throw new Error(`invalid legacy canvas: ${source}`)
  const projectId = legacyProjectId(sourceRoot, sessionId)
  let project
  try { project = await projectService.getProject(projectId) } catch (error) {
    if (error?.code !== 'not-found') throw error
    project = (await projectService.createProject({ projectId, commandId: randomUUID(), payload: { title: title || `迁移项目 ${sessionId}` } })).project
  }
  const result = await projectService.execute({
    projectId, commandId: randomUUID(), expectedRevision: project.revision,
    type: 'replaceLegacyCanvas', payload: { canvas }, actor: 'migration',
  })
  return {
    source, projectId, sourceNodeCount: canvas.nodes.length,
    importedNodeCount: result.project.legacyCanvas.nodes.length,
    revision: result.project.revision,
  }
}
