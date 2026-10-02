export function lineageGraph(project) {
  const graph = new Map()
  for (const collection of [project.shots, project.assets, project.timelines, project.deliverables]) {
    for (const entity of Object.values(collection || {})) graph.set(entity.id, [...(entity.dependsOn || entity.sourceIds || entity.assetIds || [])])
  }
  for (const attempt of Object.values(project.attempts || {})) {
    graph.set(attempt.id, (attempt.inputSnapshot?.references || []).flatMap((reference) => [reference.entityId, reference.assetId]).filter(Boolean))
  }
  return graph
}

export function ancestors(project, entityId) {
  const graph = lineageGraph(project)
  const result = new Set()
  const pending = [...(graph.get(entityId) || [])]
  while (pending.length) {
    const id = pending.shift()
    if (result.has(id)) continue
    result.add(id)
    pending.push(...(graph.get(id) || []))
  }
  return [...result]
}
