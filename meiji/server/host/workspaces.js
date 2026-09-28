// Harness 工作区的唯一接入点：只使用公开的 ctx.workspaceRegistry（list / get / archivedSessionIds），
// 不读取 Harness 自己的存储文件。
// index.js 启动时登记 ctx.workspaceRegistry；未登记时调用即报 503，不静默返回空结果。
let installed = null
export function setWorkspaceRegistry(registry) { installed = registry || null }

export function hostWorkspaces(explicit) {
  const available = () => {
    const registry = explicit ?? installed
    if (typeof registry?.list !== 'function' || typeof registry?.get !== 'function') {
      throw Object.assign(new Error('Harness 工作区服务不可用'), { status: 503 })
    }
    return registry
  }
  return {
    // 会话所属的工作区；不属于任何工作区时返回 null。
    forSession(sessionId) {
      for (const workspace of available().list()) {
        if (workspace.sessionIds?.includes(sessionId)) {
          const title = typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title.trim() : workspace.id
          return { id: workspace.id, title }
        }
      }
      return null
    },
    // 工作区内未归档的会话，保持 Harness 的会话顺序。
    activeSessions(workspaceId) {
      const current = available()
      const archived = new Set(current.archivedSessionIds || [])
      return (current.get(workspaceId)?.sessionIds || []).filter(id => !archived.has(id))
    },
  }
}
