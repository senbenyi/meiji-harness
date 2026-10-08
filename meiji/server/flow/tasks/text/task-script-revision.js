import { outlineText } from '../../../../shared/story-outline.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { applyScriptChanges, scriptAppendOnly, scriptTargets } from '../../../../shared/script-assembly.js'
import { scriptStore } from '../../../data/script-store.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { runTextNodes } from '../text-workflow.js'
import { promptsForScriptChanges } from '../../steps/step-generate-script-changes.js'
import { reviewScriptChanges } from '../../steps/step-review-script-changes.js'
import { reviseScriptChanges } from '../../steps/step-revise-script-changes.js'
import { saveTaskDraft } from '../../../data/content-records.js'
import { runStore } from '../../../data/run-store.js'

export async function runScriptRevision({ home, operation, deps, rootProjects, project, models, trace }) {
  const episode = project.episodes.find(item => item.id === operation.episodeId), deletion = project.scriptPendingDeletes.find(item => item.episodeId === operation.episodeId)
  const ordered = [...project.episodes].reverse(), index = ordered.findIndex(item => item.id === operation.episodeId)
  const targets = scriptTargets(project).filter(target => operation.action === 'script-sync' || target.kind !== 'episode' || ordered.findIndex(item => item.id === target.episodeId) >= (operation.fromEpisode == null ? ordered.length : Number(operation.fromEpisode)))
  const history = await runStore(home, project.id).listRecords('artifacts')
  const prior = history.filter(item => item.episodeId === episode?.id && item.target === 'outline' && item.published && item.version < (episode?.plot.outline.source?.version || Infinity)).sort((a, b) => b.version - a.version)[0]
  const facts = { targets, kind: project.scriptKind, sections: project.scriptSections,
    episodeId: operation.episodeId || null, summaryBefore: deletion?.summaryBefore || outlineText(prior?.content), summaryAfter: outlineText(episode?.plot.outline.content),
    previous: outlineText(ordered[index - 1]?.plot.outline.content), next: outlineText(ordered[index + 1]?.plot.outline.content), deletion: deletion || null }
  const parse = text => {
    const value = parseJsonValue(text)
    if (typeof value.needsChange !== 'boolean' || typeof value.note !== 'string' || !Array.isArray(value.changes) || value.needsChange !== Boolean(value.changes.length)) throw new Error('剧本回写协议无效')
    if (operation.action === 'script-sync' && !project.script && episode?.plot.outline.content && !value.needsChange) throw new Error('首集回写必须建立剧本')
    const next = applyScriptChanges(project, value.changes, { allowedTargets: targets })
    if (operation.action === 'script-sync' && project.scriptKind === 'assembled' && episode?.plot.outline.content && !project.scriptSections.sections.find(item => item.episodeId === episode.id)?.text?.trim() && !next.scriptSections.sections.find(item => item.episodeId === episode.id)?.text?.trim()) throw new Error('本集尚无剧本小节，回写必须新增本集正文，不能判为无需修改')
    return value
  }
  const prompts = promptsForScriptChanges(project, operation, facts), options = { route: modelRoutes(await models.read()).story, project, signal: deps.signal, fetchImpl: deps.fetchImpl, request: deps.request }
  let result
  if (deps.runId && ['review', 'revise'].includes(operation.step)) {
    const parent = deps.step.input.reviewedStepId || deps.step.after[0]
    const generated = operation.step === 'revise' ? deps.run.steps.find(step => step.id === parent)?.after[0] : parent
    const records = await runStore(home, project.id).records(deps.runId, generated, 'artifacts')
    const draft = records.filter(record => record.target === 'script-draft').at(-1)?.content
    if (!draft || draft.scriptRevision !== project.scriptRevision || draft.outlineRevision !== episode?.plot.outline.revision) throw new Error('剧本方案草稿缺失或依据已变化，请重新生成')
    if (operation.step === 'review') {
      const reviewed = await reviewScriptChanges({ target: 'script', text: draft.text, prompts, options, check: text => { parse(text); return [] } })
      result = { ...reviewed, text: draft.text }
    } else {
      const text = await reviseScriptChanges({ target: 'script', prompts, options, baseContent: draft.text, revisionOpinion: operation.review, persist: async text => { parse(text); await saveTaskDraft('script-draft', { text, scriptRevision: project.scriptRevision, outlineRevision: episode?.plot.outline.revision }); return true } })
      trace.result = { draftSaved: true }; return trace
    }
  } else result = await runTextNodes({ target: 'script', prompts, options, check: text => { parse(text); return [] },
    ...(deps.runId && operation.step === 'generate' ? { persist: async text => { await saveTaskDraft('script-draft', { text, scriptRevision: project.scriptRevision, outlineRevision: episode?.plot.outline.revision }); return true } } : {}) })
  trace.result = { stepCompleted: true, reviewPassed: result.check.passed }
  if (!result.check.passed) return trace
  const value = parse(result.text), scripts = scriptStore(home, rootProjects)
  const markSynced = current => {
    const target = current.episodes.find(item => item.id === operation.episodeId)
    if (target) {
      if (target.plot.outline.revision !== episode.plot.outline.revision) throw Object.assign(new Error('故事小段依据已变化'), { status: 409 })
      target.plot.outline.basis = { ...target.plot.outline.basis, scriptSyncedRevision: episode.plot.outline.revision }
    } else current.scriptPendingDeletes = current.scriptPendingDeletes.filter(item => item.episodeId !== operation.episodeId)
    current.scriptProposals = current.scriptProposals.map(item => item.source === 'episode-sync' && item.episodeId === operation.episodeId && item.status === 'pending' ? { ...item, status: 'superseded' } : item)
    return current
  }
  if (!value.needsChange) {
    if (operation.action === 'script-sync') await rootProjects.save(project.id, markSynced)
    trace.result = { ...trace.result, needsChange: false, note: value.note }; return trace
  }
  const next = applyScriptChanges(project, value.changes, { allowedTargets: targets })
  if (operation.action === 'script-sync' && !deletion && scriptAppendOnly(project, next, episode?.id)) {
    await scripts.commit(project.id, current => ({ ...markSynced(current), ...next }), { baseRevision: project.scriptRevision, source: 'episode-sync', actor: 'model', episodeId: episode?.id, runId: deps.runId, stepId: deps.writeToken, note: value.note, changes: value.changes })
    trace.result = { ...trace.result, scriptRevision: project.scriptRevision + 1, synced: true }; return trace
  }
  const proposalId = await scripts.propose(project.id, { source: operation.action === 'script-sync' ? 'episode-sync' : 'ai-edit', baseRevision: project.scriptRevision,
    episodeId: operation.episodeId || null, outlineRevision: episode?.plot.outline.revision, deleteFact: deletion, note: value.note, changes: value.changes, requirements: operation.requirements,
    runId: deps.runId, stepId: deps.writeToken })
  trace.result = { ...trace.result, pendingProposal: proposalId }
  return trace
}
