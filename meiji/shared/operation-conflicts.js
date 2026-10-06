const projectWrites = new Set(['episode-add', 'episode-edit', 'episode-delete', 'overview', 'source'])

// 占用范围：项目级写入与一切互斥；其余按集、按对象互斥。Run 步骤显式传入 lock 与 target。
export function operationScope(operation) {
  const actionTarget = { 'outline-text': 'outline', 'character-text': 'characters', 'scene-text': 'scenes', 'prop-text': 'props', 'storyboard-text': 'storyboard', 'import-image': 'image', 'use-asset': 'image', 'clear-image': 'image' }[operation.action]
  const target = operation.target || (actionTarget ? `${actionTarget}${operation.track ? ':' + operation.track : operation.itemId && actionTarget === 'image' ? ':' + operation.itemId : ''}` : null)
  return { lock: operation.lock || (projectWrites.has(operation.action) || !operation.episodeId ? 'project' : 'episode'), episodeId: operation.episodeId || null, target }
}

export function conflicts(a, b) {
  if (a.projectId !== b.projectId) return false
  const first = operationScope(a), second = operationScope(b)
  return first.lock === 'project' || second.lock === 'project' || first.episodeId === second.episodeId && (!first.target || !second.target || first.target === second.target)
}
