// HTTP 与会话共用创建入口；创建后不自动生成摘要。
import { projectStore } from '../data/project-store.js'
export async function createProject({ home, tasks, fields, enter, session, sessionId, signal, workspaceController, origin = 'panel' }) {
  const started = tasks.start({ action: 'create', fields, origin, ...(sessionId ? { sessionId } : {}) }, session, { signal, workspaceController })
  const result = await started.done
  if (started.failure) throw started.failure
  return enter(await projectStore(home).read(result.result.projectId))
}
