// 展示摘要：已有剧集的故事小段生成后提取，不创建剧集，不推动剧情。
import { episodeSummaryFailures } from '../../../../shared/episode-summary.js'
import { promptsForSummary } from '../../steps/step-generate-summary.js'
import { generateStep } from '../../steps/shared/text-generate.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { contentNode } from '../../../models/data/drama-model.js'
import { checkContext } from '../../../runtime/operation-context.js'

export async function generateEpisode({ route, project, episodeId, signal, fetchImpl, request, persist }) {
  const target = project.episodes?.find(episode => episode.id === episodeId) || project
  const text = await generateStep({ target: 'summary', message: promptsForSummary(project, episodeId).generation,
    options: { route, project, signal, fetchImpl, request, logStage: '提取展示摘要' } })
  const value = parseJsonValue(text), failures = episodeSummaryFailures(value)
  if (failures.length) throw new Error(failures.join('；'))
  const draft = { summary: value.summary.trim(), durationSeconds: target.durationSeconds, check: { passed: true, failures: [] } }
  await persist?.(draft)
  return draft
}
export async function runSummary({ operation, deps, projects, models, project, trace }) {
  if (operation.draft) throw Object.assign(new Error('摘要仅作展示，不再支持创建剧集草稿'), { status: 400 })
  const revision = project.plot.outline.revision
  const draft = await (deps.generateEpisode || generateEpisode)({ route: modelRoutes(await models.read()).story, project,
    request: deps.request, fetchImpl: deps.fetchImpl, signal: deps.signal })
  await projects.save(project.id, current => {
    if (current.plot.outline.revision !== revision) throw Object.assign(new Error('故事小段已变化，请重新提取摘要'), { status: 409 })
    return { summary: { ...contentNode(current.summary, draft.summary, { passed: true, failures: [] }), outlineRevision: revision } }
  })
  if (checkContext.getStore()) checkContext.getStore().validation = []
  trace.result = { summary: draft.summary }
  return trace
}
export const opEpisodeGenerate = runSummary
export const opEpisodeSummaryDraft = () => { throw new Error('摘要仅作展示，不再支持创建剧集草稿') }
