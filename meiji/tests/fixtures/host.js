// 模拟 Harness 公开的 ctx.workspaceRegistry：rows 为 { [workspaceId]: { title, path, sessionIds } }，archived 为已归档会话 id。
import { setWorkspaceRegistry } from '../../server/host/workspaces.js'

export function fakeRegistry(rows = {}, archived = []) {
  return {
    list: () => Object.entries(rows).map(([id, row]) => ({ id, ...row })),
    get: id => rows[id] ? { id, ...rows[id] } : undefined,
    get archivedSessionIds() { return archived },
  }
}

// 在当前测试期间登记模拟 registry，结束后恢复未登记状态。
export function useWorkspaces(t, rows = {}, archived = []) {
  const registry = fakeRegistry(rows, archived)
  setWorkspaceRegistry(registry)
  t.after(() => setWorkspaceRegistry(null))
  return registry
}
