import { createHash } from 'node:crypto'

export function productionCoordinatorLabel(task) {
  const labels = {
    'novel-production-root': '短剧全流程协调',
    'author-creative': '创作修改协调',
    'revise-text': '文本修改协调',
    'render-reference': '资产参考图协调',
    'render-storyboard': '分镜图协调',
  }
  return labels[task?.kind] || '短剧生产协调'
}

export function productionCoordinatorSessionId(task) {
  const identity = `${task?.id || 'unknown'}:${Number(task?.attemptNumber || 0)}`
  return `studio-production-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

export function productionCoordinatorDescriptor(label) {
  return {
    version: 3,
    mode: 'one-shot',
    provider: 'spawn',
    label,
  }
}

export function registerProductionCoordinator(parent, child, label, catalog = []) {
  if (!parent?.append || !child?.id || catalog.some((entry) => entry.id === child.id)) return false
  const childCreatedAt = Number.isFinite(child.createdAt) ? child.createdAt : Date.now()
  parent.append('subagent/catalog', {
    version: 0,
    childId: child.id,
    childCreatedAt,
    mode: 'one-shot',
    label,
  })
  return true
}
