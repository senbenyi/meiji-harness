// 任务：剧集摘要（生成本集摘要；弹框 AI 草稿为同一任务的草稿模式）
import { episodeSummaryFailures, referenceDuration } from '../../../../shared/episode-summary.js'
import { runTextSteps } from '../../../runtime/text-generation.js'
import { buildEpisodePrompts } from '../../../prompts/episode-summary-prompts.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { normalizeEpisodeDraft } from '../../../../shared/story-content.js'
import { addEpisode, editEpisode, materialize, normalizeProject } from '../../../../shared/episode-rules.js'
import { scopeProjects } from '../../../data/episode-data.js'
import { prepareChecks } from '../../../runtime/review-checks.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { GenerationStatus, consumeReview } from '../../../../shared/drama-model.js'
import { runStep } from '../../../runtime/task-execution.js'
import { saveTaskDraft } from '../../../data/content-records.js'
import { textSteps } from '../plan-steps.js'

export async function generateEpisode({ route, project, episodeId, referenceDurationSeconds, signal, fetchImpl, request, persist }) {
  const reference = referenceDuration(referenceDurationSeconds ?? project.episodes?.find(episode => episode.id === episodeId)?.durationSeconds)
  const result = await runTextSteps({
    target: 'summary',
    prompts: buildEpisodePrompts(project, episodeId, reference),
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
  await rootProjects.save(project.id, { activity: 'episode', activityError: null })
  note('按「剧集摘要」技能生成本集剧情')
  note('操作：episode-generate（会话与面板共用）')
  note('技能：剧集摘要（skills/task/generate-episode-summary-skill.md）')
  note('函数：generateEpisode（server/flow/operations/tasks/episode-summary.js）')
  let episodeId = existing?.id
  const persist = async draft => {
    await rootProjects.save(project.id, current => {
      const patch = episodeId ? editEpisode(current, episodeId, { summary: draft.summary, durationSeconds: draft.durationSeconds }) : addEpisode(current, draft)
      const updated = episodeId ? patch.episodes.find(item => item.id === episodeId) : patch.episodes[0]
      episodeId = updated.id
      updated.summary.check = { ...(draft.check || { passed: null, failures: [] }), revision: updated.summary.revision }
      updated.summary.status = draft.check?.passed === true ? GenerationStatus.PASSED : GenerationStatus.FAILED
      return { ...patch, activity: 'episode' }
    })
  }
  const draft = await (deps.generateEpisode || generateEpisode)({ route: (modelRoutes(await models.read())).story, project, episodeId: operation.episodeId, referenceDurationSeconds: operation.referenceDurationSeconds, persist })
  await persist(draft)
  if (existing) await rootProjects.save(project.id, current => {
    const next = structuredClone(current)
    const target = next.episodes.find(item => item.id === episodeId).summary
    if (target.check.passed === true) consumeReview(target)
    return next
  })
  trace.result = { episodeId }
  await rootProjects.save(project.id, { activity: null, activityError: null })
  note(existing ? `已重新生成第 ${project.episodes.length - project.episodes.findIndex(episode => episode.id === existing.id)} 集摘要，本集时长 ${draft.durationSeconds} 秒` : `已生成第 ${project.episodes.length + 1} 集，${draft.durationSeconds} 秒`)
  if (existing && existing.summary.content !== draft.summary) note('本集下游制作数据已重置，需要重新生成')
  note(draft.summary)
  return trace
}

// 弹框草稿：仅记录任务结果，保存按钮才写入剧集。
export async function opEpisodeSummaryDraft({ operation, deps, models, project, trace }) {
  const draft = await (deps.generateEpisode || generateEpisode)({
    route: (modelRoutes(await models.read())).story, project, episodeId: operation.episodeId,
    referenceDurationSeconds: operation.referenceDurationSeconds,
  })
  deps.signal?.throwIfAborted()
  await runStep('save', () => saveTaskDraft('summary-draft', draft), { target: 'summary-draft' })
  trace.result = { draft }
  return trace
}

export const operations = {
  'episode-generate': { label: '生成本集剧情', scope: 'project', queue: 'text', agent: true, plan: () => textSteps('summary'), stage: 'project', run: opEpisodeGenerate },
  'episode-summary-draft': { label: 'AI 生成摘要草稿', scope: 'project', queue: 'text', agent: false, plan: () => [...textSteps('summary'), { kind: 'save', target: 'summary-draft' }], stage: 'project', run: opEpisodeSummaryDraft },
}
