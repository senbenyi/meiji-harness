const generation = new Set(['summary', 'story', 'project-summary', 'script-sync', 'script-revise', 'shot-table', 'seconds', 'film', 'character-image', 'scene-image', 'prop-image', 'images'])
const projectWrites = new Set(['summary', 'story', 'project-summary', 'script-sync', 'script-revise', 'episode-add', 'episode-edit', 'episode-delete', 'overview', 'source'])

export function operationScope(operation) {
  const actionTarget = { 'outline-text': 'outline', 'character-text': 'characters', 'scene-text': 'scenes', 'prop-text': 'props', 'shot-table': 'shots', 'shot-seconds': 'seconds', 'shot-storyboard': 'storyboard', 'storyboard-text': 'storyboard', 'import-image': 'image', 'use-asset': 'image', 'clear-image': 'image' }[operation.action]
  const target = operation.target || (actionTarget ? `${actionTarget}${operation.track ? ':' + operation.track : operation.itemId && actionTarget === 'image' ? ':' + operation.itemId : ''}` : null)
  return { kind: operation.kind || (generation.has(operation.action) ? 'generate' : 'direct'), lock: operation.lock || (projectWrites.has(operation.action) || !operation.episodeId ? 'project' : 'episode'), episodeId: operation.episodeId || null, target }
}

export function conflicts(a, b) {
  if (a.projectId !== b.projectId) return false
  const first = operationScope(a), second = operationScope(b)
  return first.kind === 'generate' && second.kind === 'generate' || first.lock === 'project' || second.lock === 'project' || first.episodeId === second.episodeId && (!first.target || !second.target || first.target === second.target)
}
