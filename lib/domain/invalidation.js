const MAX_INVALIDATION_DEPTH = 100

export function collectDependents(project, sourceIds) {
  const pending = [...new Set(sourceIds)]
  const invalid = new Set()
  let depth = 0
  while (pending.length) {
    if (++depth > MAX_INVALIDATION_DEPTH) throw new Error(`invalidation depth exceeded ${MAX_INVALIDATION_DEPTH} — possible circular dependency`)
    const source = pending.shift()
    for (const collection of [project.shots, project.assets, project.timelines, project.deliverables]) {
      for (const entity of Object.values(collection || {})) {
        const deps = entity.dependsOn || []
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
