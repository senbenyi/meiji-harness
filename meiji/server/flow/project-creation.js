// HTTP 与会话共用创建入口；剧本模式的项目摘要由面板在进入详情后异步创建 Run。
import { projectStore } from '../data/project-store.js'
export async function createProject({ home, edits, fields, enter, session, sessionId, signal, workspaceController, origin = 'panel' }) {
  const started = edits.start({ action: 'create', fields, origin, ...(sessionId ? { sessionId } : {}) }, session, { signal, workspaceController })
  const result = await started.done
  if (started.failure) throw started.failure
  return enter(await projectStore(home).read(result.result.projectId))
}
