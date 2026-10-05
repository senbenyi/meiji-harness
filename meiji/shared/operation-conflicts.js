const generation = new Set(['summary', 'story', 'project-summary', 'script-sync', 'script-revise', 'shot-table', 'seconds', 'film', 'character-image', 'scene-image', 'prop-image', 'images'])
const projectWrites = new Set(['summary', 'story', 'project-summary', 'script-sync', 'script-revise', 'episode-add', 'episode-edit', 'episode-delete', 'overview', 'source'])

export function operationScope(operation) {
  return { kind: operation.kind || (generation.has(operation.action) ? 'generate' : 'direct'), lock: operation.lock || (projectWrites.has(operation.action) || !operation.episodeId ? 'project' : 'episode'), episodeId: operation.episodeId || null }
}

export function conflicts(a, b) {
  if (a.projectId !== b.projectId) return false
  const first = operationScope(a), second = operationScope(b)
  return first.kind === 'generate' && second.kind === 'generate' || first.lock === 'project' || second.lock === 'project' || first.episodeId === second.episodeId
}
