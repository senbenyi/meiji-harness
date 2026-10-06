// 任务：剧集摘要（生成本集摘要；弹框 AI 草稿为同一任务的草稿模式）
import { episodeSummaryFailures, referenceDuration } from '../../../../shared/episode-summary.js'
import { runTextNodes } from '../text-workflow.js'
import { promptsForSummary } from '../../steps/step-generate-summary.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { normalizeEpisodeDraft } from '../../../../shared/story-content.js'
import { addEpisode, editEpisode, materialize, normalizeProject } from '../../../../shared/episode-rules.js'
import { scopeProjects } from '../../../data/episode-data.js'
import { prepareChecks } from '../../../runtime/review-checks.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { GenerationStatus, consumeReview } from '../../../../shared/drama-model.js'
import { runNode } from '../../../runtime/step-execution.js'
import { saveTaskDraft } from '../../../data/content-records.js'
import { statusFromCheck, markPendingReview } from '../../../../shared/content-state.js'

export async function generateEpisode({ route, project, episodeId, referenceDurationSeconds, signal, fetchImpl, request, persist }) {
  const reference = referenceDuration(referenceDurationSeconds ?? project.episodes?.find(episode => episode.id === episodeId)?.durationSeconds)
  const result = await runTextNodes({
    target: 'summary',
    prompts: promptsForSummary(project, episodeId, reference),
    options: { route, project: { ...project, durationSeconds: reference }, signal, fetchImpl, request },
    check: text => episodeSummaryFailures(parseJsonValue(text)),
    persist: persist && ((text, check) => persist({ ...normalizeEpisodeDraft(parseJsonValue(text), reference), check })),
  })
  return { ...normalizeEpisodeDraft(parseJsonValue(result.text), reference), check: result.check }
}

// if (operation.action === 'episode-generate')
export async function opEpisodeGenerate(c) {
  let { operation, deps, rootProjects, models, project, trace, note } = c
  const existing = operation.episodeId ? project.episodes.find(episode => episode.id === operation.episodeId) : null
  if (operation.episodeId && !existing) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  if (existing) {
    const prepared = await prepareChecks(scopeProjects(rootProjects, existing.id), materialize(project, existing.id), operation)
    operation = c.operation = prepared.operation
    project = normalizeProject(await rootProjects.read(project.id))
  }
  note('按「剧集摘要」技能生成本集剧情')
  note('操作：episode-generate（会话与面板共用）')
  note('技能：剧集摘要（skills/task/generate-episode-summary-skill.md）')
  note('函数：generateEpisode（server/flow/tasks/text/task-summary.js）')
  let episodeId = existing?.id
  const persist = async draft => {
    await rootProjects.save(project.id, current => {
      const patch = episodeId ? editEpisode(current, episodeId, { summary: draft.summary, durationSeconds: draft.durationSeconds }) : addEpisode(current, draft)
      const updated = episodeId ? patch.episodes.find(item => item.id === episodeId) : patch.episodes[0]
      episodeId = updated.id
      updated.summary.check = { ...(draft.check || { passed: null, failures: [] }), revision: updated.summary.revision }
      draft.check?.passed == null && operation.step ? markPendingReview(updated.summary) : statusFromCheck(updated.summary)
      return patch
    })
  }
  const draft = await (deps.generateEpisode || generateEpisode)({ route: (modelRoutes(await models.read())).story, project, episodeId: operation.episodeId, referenceDurationSeconds: operation.referenceDurationSeconds, persist, request: deps.request, fetchImpl: deps.fetchImpl })
  await persist(draft)
  if (existing) await rootProjects.save(project.id, current => {
    const next = structuredClone(current)
    const target = next.episodes.find(item => item.id === episodeId).summary
    if (target.check.passed === true) consumeReview(target)
    return next
  })
  trace.result = { episodeId }
  note(existing ? `已重新生成第 ${project.episodes.length - project.episodes.findIndex(episode => episode.id === existing.id)} 集摘要，本集时长 ${draft.durationSeconds} 秒` : `已生成第 ${project.episodes.length + 1} 集，${draft.durationSeconds} 秒`)
  if (existing && existing.summary.content !== draft.summary) note('本集下游制作数据已重置，需要重新生成')
  note(draft.summary)
  return trace
}

// 弹框草稿：仅记录任务结果，保存按钮才写入剧集。
export async function opEpisodeSummaryDraft({ operation, deps, models, project, trace }) {
  if (deps.run && ['review', 're_review', 'revise'].includes(deps.step.kind)) {
    const previous = deps.run.steps.find(item => item.id === deps.step.after[0])
    const draft = previous?.output?.result?.draft
    if (!draft) throw new Error('摘要草稿依据不存在')
    const prompts = promptsForSummary(project, operation.episodeId, operation.referenceDurationSeconds), options = { route: modelRoutes(await models.read()).story, project, signal: deps.signal, request: deps.request, fetchImpl: deps.fetchImpl }
    if (deps.step.kind === 'revise') {
      const opinion = JSON.stringify(deps.step.input.feedback), text = await runNode('revise', () => deps.task.steps.revise({ prompts, message: prompts.revision(JSON.stringify(draft), opinion), baseContent: JSON.stringify(draft), revisionOpinion: opinion, round: deps.step.round, target: 'summary', options }))
      const revised = normalizeEpisodeDraft(parseJsonValue(text), draft.durationSeconds)
      const failures = episodeSummaryFailures(revised)
      if (failures.length) throw new Error(failures.join('；'))
      await saveTaskDraft('summary-draft', revised); trace.result = { draft: revised }; return trace
    }
    const result = await deps.task.steps.review({ prompts, text: JSON.stringify(draft), target: 'summary', options })
    trace.result = { draft, reviewPassed: result.check.passed }; return trace
  }
  const draft = await (deps.generateEpisode || generateEpisode)({
    route: (modelRoutes(await models.read())).story, project, episodeId: operation.episodeId,
    referenceDurationSeconds: operation.referenceDurationSeconds,
    request: deps.request, fetchImpl: deps.fetchImpl,
  })
  deps.signal?.throwIfAborted()
  await runNode('save', () => saveTaskDraft('summary-draft', draft), { target: 'summary-draft' })
  trace.result = { draft }
  return trace
}


export const runSummary = context => context.operation.draft ? opEpisodeSummaryDraft(context) : opEpisodeGenerate(context)
