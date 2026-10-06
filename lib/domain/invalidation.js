import { transition } from './state-machines.js'

const MAX_INVALIDATION_DEPTH = 100

const INVALIDATABLE_COLLECTIONS = [
  { name: 'shots', machine: 'shot' },
  { name: 'assets', machine: 'asset' },
  { name: 'timelines', machine: 'timeline' },
  { name: 'deliverables', machine: 'deliverable' },
]

export function collectDependents(project, sourceIds) {
  const pending = [...new Set(sourceIds)]
  const invalid = new Set()
  let depth = 0
  while (pending.length) {
    if (++depth > MAX_INVALIDATION_DEPTH) throw new Error(`invalidation depth exceeded ${MAX_INVALIDATION_DEPTH} — possible circular dependency`)
    const source = pending.shift()
    for (const { name } of INVALIDATABLE_COLLECTIONS) {
      for (const entity of Object.values(project[name] || {})) {
        const deps = [...(entity.dependsOn || [])]
        if (name === 'assets') {
          for (const shot of Object.values(project.shots || {})) {
            if ((shot.assetIds || []).includes(entity.id) || shot.approvedAssetId === entity.id || shot.storyboardAssetId === entity.id) deps.push(shot.id)
          }
          for (const owner of [...Object.values(project.characters || {}), ...Object.values(project.locations || {})]) {
            if (owner.referenceAssetId === entity.id) deps.push(owner.id)
          }
        }
        if (name === 'timelines') deps.push(...(entity.assetIds || []))
        if (name === 'deliverables' && entity.timelineId) deps.push(entity.timelineId)
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
  const updates = []
  for (const id of ids) {
    for (const { name, machine } of INVALIDATABLE_COLLECTIONS) {
      const entity = project[name][id]
      if (!entity) continue
      if (['invalidated', 'archived'].includes(entity.status)) continue
      updates.push({ name, id, next: transition(entity, machine, 'invalidated', { invalidatedAt: timestamp, invalidationReason: reason }) })
    }
  }
  for (const { name, id, next } of updates) project[name][id] = next
  if (updates.length && project.status === 'completed') Object.assign(project, transition(project, 'project', 'active'))
  for (const episode of Object.values(project.episodes || {})) {
    if (episode.status === 'delivered' && (episode.shotIds || []).some((id) => ids.includes(id) || sourceIds.includes(id))) {
      project.episodes[episode.id] = transition(episode, 'episode', 'rendering')
    }
  }
  return updates.map(({ id }) => id)
}
