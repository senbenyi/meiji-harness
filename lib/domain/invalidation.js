import { STATE_TRANSITIONS } from './state-machines.js'

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
  const applied = []
  for (const id of ids) {
    for (const { name, machine } of INVALIDATABLE_COLLECTIONS) {
      const entity = project[name][id]
      if (!entity) continue
      const allowed = STATE_TRANSITIONS[machine]?.[entity.status]
      if (!allowed || !allowed.includes('invalidated')) continue
      project[name][id] = { ...entity, status: 'invalidated', invalidatedAt: timestamp, invalidationReason: reason, updatedAt: timestamp }
      applied.push(id)
    }
  }
  return applied
}
