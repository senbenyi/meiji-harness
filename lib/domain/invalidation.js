export function collectDependents(project, sourceIds) {
  const pending = [...new Set(sourceIds)]
  const invalid = new Set()
  while (pending.length) {
    const source = pending.shift()
    for (const collection of [project.shots, project.assets, project.timelines, project.deliverables]) {
      for (const entity of Object.values(collection || {})) {
        const deps = entity.dependsOn || entity.sourceIds || entity.assetIds || []
        if (!invalid.has(entity.id) && deps.includes(source)) {
          invalid.add(entity.id)
          pending.push(entity.id)
        }
      }
    }
  }
  return [...invalid]
}

export function invalidateDependents(project, sourceIds, reason) {
  const ids = collectDependents(project, sourceIds)
  const timestamp = new Date().toISOString()
  for (const id of ids) {
    for (const name of ['shots', 'assets', 'timelines', 'deliverables']) {
      const entity = project[name][id]
      if (!entity) continue
      project[name][id] = { ...entity, status: 'invalidated', invalidatedAt: timestamp, invalidationReason: reason }
    }
  }
  return ids
}
