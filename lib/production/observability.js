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

const NOVEL_TODO_CONTENT = [
  '创建项目并导入源文',
  '完成文本改编与资产设定',
  '生成资产参考图',
  '生成分镜与视频',
  '合成并交付成片',
]

export async function syncNovelTodoTerminal(tools, exec, outcome, log = console) {
  if (!tools?.get || !exec?.agent) return false
  const todos = outcome?.ok
    ? NOVEL_TODO_CONTENT.map((content) => ({ content, status: 'completed' }))
    : []
  try {
    const tool = tools.get('todo_write', exec.agent)
    if (!tool?.execute) return false
    await tool.execute({ todos }, exec)
    return true
  } catch (error) {
    log.warn?.('[dsh-short-video-studio] novel todo terminal sync failed:', error?.message || String(error))
    return false
  }
}
