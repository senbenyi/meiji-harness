import { modelRoutes } from '../../../../models/model-config.js'
import { applyScriptChanges, scriptAppendOnly, scriptTargets } from '../../../../shared/script-assembly.js'
import { scriptStore } from '../../../data/script-store.js'
import { recordStore } from '../../../data/task-store.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { runTextNodes } from '../../../runtime/text-generation.js'
import { buildTextPrompts } from '../../../prompts/text-prompts.js'

export async function runScriptRevision({ home, operation, deps, rootProjects, project, models, trace }) {
  const episode = project.episodes.find(item => item.id === operation.episodeId), deletion = project.scriptPendingDeletes.find(item => item.episodeId === operation.episodeId)
  const ordered = [...project.episodes].reverse(), index = ordered.findIndex(item => item.id === operation.episodeId)
  const targets = scriptTargets(project).filter(target => operation.action === 'script-sync' || target.kind !== 'episode' || ordered.findIndex(item => item.id === target.episodeId) >= (operation.fromEpisode == null ? ordered.length : Number(operation.fromEpisode)))
  const history = await recordStore(home, project.id).list('artifacts')
  const prior = history.filter(item => item.episodeId === episode?.id && item.target === 'summary' && item.published && item.version < (episode?.summary.source?.version || Infinity)).sort((a, b) => b.version - a.version)[0]
  const facts = { targets, kind: project.scriptKind, sections: project.scriptSections,
    episodeId: operation.episodeId || null, summaryBefore: deletion?.summaryBefore || prior?.content || '', summaryAfter: episode?.summary.content || '',
    previous: ordered[index - 1]?.summary.content || '', next: ordered[index + 1]?.summary.content || '', deletion: deletion || null }
  const parse = text => {
    const value = parseJsonValue(text)
    if (typeof value.needsChange !== 'boolean' || typeof value.note !== 'string' || !Array.isArray(value.changes) || value.needsChange !== Boolean(value.changes.length)) throw new Error('剧本回写协议无效')
    if (operation.action === 'script-sync' && !project.script && episode?.summary.content && !value.needsChange) throw new Error('首集回写必须建立剧本')
    const next = applyScriptChanges(project, value.changes, { allowedTargets: targets })
    if (operation.action === 'script-sync' && project.scriptKind === 'assembled' && episode?.summary.content && !project.scriptSections.sections.find(item => item.episodeId === episode.id)?.text?.trim() && !next.scriptSections.sections.find(item => item.episodeId === episode.id)?.text?.trim()) throw new Error('本集尚无剧本小节，回写必须新增本集正文，不能判为无需修改')
    return value
  }
  const result = await runTextNodes({ target: 'script', prompts: buildTextPrompts({ skill: 'script-revision', project, operation, facts }),
    options: { route: modelRoutes(await models.read()).story, project, signal: deps.signal, fetchImpl: deps.fetchImpl, request: deps.request }, check: text => { parse(text); return [] } })
  if (!result.check.passed) return trace
  const value = parse(result.text), scripts = scriptStore(home, rootProjects)
  const markSynced = current => {
    const target = current.episodes.find(item => item.id === operation.episodeId)
    if (target) {
      if (target.summary.revision !== episode.summary.revision) throw Object.assign(new Error('摘要依据已变化'), { status: 409 })
      target.summary.basis = { ...target.summary.basis, scriptSyncedRevision: episode.summary.revision }
    } else current.scriptPendingDeletes = current.scriptPendingDeletes.filter(item => item.episodeId !== operation.episodeId)
    current.scriptProposals = current.scriptProposals.map(item => item.source === 'episode-sync' && item.episodeId === operation.episodeId && item.status === 'pending' ? { ...item, status: 'superseded' } : item)
    return current
  }
  if (!value.needsChange) {
    if (operation.action === 'script-sync') await rootProjects.save(project.id, markSynced)
    trace.result = { needsChange: false, note: value.note }; return trace
  }
  const next = applyScriptChanges(project, value.changes, { allowedTargets: targets })
  if (operation.action === 'script-sync' && !deletion && scriptAppendOnly(project, next, episode?.id)) {
    await scripts.commit(project.id, current => ({ ...markSynced(current), ...next }), { baseRevision: project.scriptRevision, source: 'episode-sync', actor: 'model', episodeId: episode?.id, taskId: deps.taskId, operationId: deps.operationId, note: value.note, changes: value.changes })
    trace.result = { scriptRevision: project.scriptRevision + 1, synced: true }; return trace
  }
  const proposalId = await scripts.propose(project.id, { source: operation.action === 'script-sync' ? 'episode-sync' : 'ai-edit', baseRevision: project.scriptRevision,
    episodeId: operation.episodeId || null, summaryRevision: episode?.summary.revision, deleteFact: deletion, note: value.note, changes: value.changes, requirements: operation.requirements,
    taskId: deps.taskId, operationId: deps.operationId })
  trace.result = { pendingProposal: proposalId }
  return trace
}
