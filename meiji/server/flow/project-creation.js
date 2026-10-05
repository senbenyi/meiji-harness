// 创建、绑定工作区后启动独立摘要任务；HTTP 与会话共用，模型失败不删除项目。
import { projectStore } from '../data/project-store.js'

export async function createProject({ home, tasks, fields, enter, sessionOf = () => null, session, sessionId, signal, workspaceController, origin = 'panel' }) {
  const started = tasks.start({ action: 'create', fields, origin, ...(sessionId ? { sessionId } : {}) }, session, { signal, workspaceController })
  const result = await started.done
  if (started.failure) throw started.failure
  const project = await projectStore(home).read(result.result.projectId)
  const place = await enter(project)
  if (!project.script) return place
  const summary = tasks.start({ action: 'project-summary', projectId: project.id, sessionId: place.sessionId, origin }, session || sessionOf(place.sessionId), { signal })
  await summary.ready
  return { ...place, operationId: summary.id }
}
