import { assertProductionStages, isPreparedImage, isStandaloneShot, preparationSignature } from '../domain/policies.js'
import { ENTITY_COLLECTIONS, entityFor, assertGenerationReady } from '../prompts/specification.js'

/** Build durable reference → storyboard → video → assembly dependencies. */
export function dramaProductionTasks(project, { runId, shotIds, input, assemble = true }) {
  const tasks = []
  const references = new Map()
  const renderByShot = new Map()
  const ensureReference = (kind, entityId) => {
    const entity = entityFor(project, kind, entityId)
    assertGenerationReady(project, entity, 'image')
    if (isPreparedImage(project, entity.referenceAssetId, preparationSignature(entity))) return null
    const key = `${kind}:${entity.id}`
    if (references.has(key)) return references.get(key)
    const dependencies = kind === 'variant' ? [ensureReference(entity.parentKind, entity.parentId)].filter(Boolean) : []
    const id = `${runId}:reference:${key}`
    references.set(key, id)
    tasks.push({ id, kind: 'render-reference', scopeId: entity.id, dependencies, input: { ...input, preparationKind: kind, entityId: entity.id } })
    return id
  }
  for (const shotId of shotIds) {
    const shot = project.shots[shotId]
    assertProductionStages(project, shotId, { images: false, storyboard: false })
    const dependencies = []
    if (!isStandaloneShot(project, shot)) {
      for (const binding of shot.referenceBindings.filter((item) => ENTITY_COLLECTIONS[item.kind])) {
        const dependency = ensureReference(binding.kind, binding.entityId)
        if (dependency) dependencies.push(dependency)
      }
      if (dependencies.length || !isPreparedImage(project, shot.storyboardAssetId, preparationSignature(shot))) {
        const id = `${runId}:storyboard:${shot.id}`
        tasks.push({ id, kind: 'render-storyboard', scopeId: shot.id, dependencies: [...dependencies], input: { ...input, preparationKind: 'storyboard', entityId: shot.id } })
        dependencies.push(id)
      }
    }
    const id = `${runId}:render:${shot.id}`
    renderByShot.set(shot.id, id)
    tasks.push({ id, kind: 'render-shot', scopeId: shot.id, dependencies, input: { ...input, nodeId: shot.id, title: shot.title, prompt: shot.prompt } })
  }
  if (assemble) {
    const outputs = []
    for (const episode of Object.values(project.episodes).sort((a, b) => (a.order || 0) - (b.order || 0))) {
      const nodes = (episode.shotIds || []).filter((id) => renderByShot.has(id))
      if (!nodes.length) continue
      // Whole-episode assembly must never silently omit an existing approved shot.
      if (nodes.length !== episode.shotIds.length) throw new Error(`partial episode assembly blocked: ${episode.id}`)
      const id = `${runId}:concat:${episode.id}`
      const nodeId = `${runId}:episode:${episode.id}`
      tasks.push({ id, kind: 'concat-video', scopeId: episode.id, dependencies: nodes.map((id) => renderByShot.get(id)), input: { ...input, nodes, nodeId, episodeId: episode.id, title: `${episode.title}-成片`, group: '成片', strategy: 'preserve' } })
      outputs.push({ nodeId, dependency: id })
    }
    if (outputs.length) {
      const standalone = shotIds.every((id) => isStandaloneShot(project, project.shots[id]))
      const wholeDrama = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main').every((episode) => episode.shotIds?.length && episode.shotIds.every((id) => renderByShot.has(id)))
      if ((!standalone && wholeDrama) || (standalone && outputs.length > 1)) tasks.push({ id: `${runId}:deliver`, kind: standalone ? 'concat-video' : 'deliver-drama', scopeId: project.id, dependencies: outputs.map((output) => output.dependency), input: { ...input, nodes: outputs.map((output) => output.nodeId), nodeId: `${runId}:final`, title: `${project.title}-成片`, group: '成片', strategy: 'preserve' } })
    }
  }
  return tasks
}
