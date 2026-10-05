// HTTP 与会话共用创建入口：复用已通过草稿，或绑定后启动独立摘要任务。
import { projectStore } from '../data/project-store.js'
import { publishProjectSummaryDraft } from '../data/content-records.js'
import { setContent, finish } from '../../shared/drama-model.js'
import { projectSummaryFailures } from '../../shared/script-content.js'

export async function createProject({ home, tasks, fields, enter, sessionOf = () => null, session, sessionId, signal, workspaceController, origin = 'panel' }) {
  let draft
  if (fields?.summaryDraftOperationId) {
    draft = await tasks.get(fields.summaryDraftOperationId, sessionId)
    if (draft.projectId || draft.action !== 'project-summary' || draft.status !== 'completed' || draft.draft?.check?.passed !== true || draft.draft?.scriptAssetId !== fields.scriptAssetId || projectSummaryFailures({ summary: draft.draft?.summary }).length) throw Object.assign(new Error('剧本摘要未通过或与所选剧本不一致，请重新生成'), { status: 400 })
  }
  const started = tasks.start({ action: 'create', fields, origin, ...(draft ? { summaryDraft: draft.draft } : {}), ...(sessionId ? { sessionId } : {}) }, session, { signal, workspaceController })
  const result = await started.done
  if (started.failure) throw started.failure
  const project = await projectStore(home).read(result.result.projectId)
  const place = await enter(project)
  if (draft) {
    const source = await publishProjectSummaryDraft(home, project.id, draft, place.sessionId || sessionId || null)
    await projectStore(home).save(project.id, current => {
      const next = structuredClone(current)
      setContent(next.summary, draft.draft.summary, draft.draft.check)
      finish(next.summary, draft.draft.check)
      if (source) next.summary.source = { artifactId: source.artifactId, taskId: source.taskId, nodeId: source.nodeId, version: source.version }
      return next
    })
    return place
  }
  if (!project.script) return place
  const summary = tasks.start({ action: 'project-summary', projectId: project.id, sessionId: place.sessionId, origin }, session || sessionOf(place.sessionId), { signal })
  await summary.ready
  return { ...place, operationId: summary.id }
}
