import { modelRoutes } from '../../../../models/model-config.js'
import { begin, finish, setContent } from '../../../../shared/drama-model.js'
import { projectSummaryFailures } from '../../../../shared/script-content.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { buildTextPrompts } from '../../../prompts/text-prompts.js'
import { runTextNodes } from '../../../runtime/text-generation.js'
import { saveTaskDraft } from '../../../data/content-records.js'

export async function runProjectSummary({ operation, deps, projects, models, library, project, trace }) {
  if (operation.draft && !operation.projectId) {
    const asset = await library.script(operation.scriptAssetId)
    const draftProject = { script: asset.content, outputLanguage: operation.outputLanguage, episodes: [] }
    const result = await runTextNodes({ target: 'project-summary',
      prompts: buildTextPrompts({ skill: 'project-summary', project: draftProject }),
      options: { route: modelRoutes(await models.read()).story, project: draftProject, fetchImpl: deps.fetchImpl, request: deps.request },
      check: text => projectSummaryFailures(parseJsonValue(text)),
      persist: async (text, check) => { await saveTaskDraft('project-summary', { summary: parseJsonValue(text).summary.trim(), scriptAssetId: asset.id, check }); return true },
    })
    trace.result = { draft: { summary: parseJsonValue(result.text).summary.trim(), scriptAssetId: asset.id, check: result.check } }
    return trace
  }
  await projects.save(project.id, current => {
    const next = structuredClone(current)
    begin(next.summary, { id: deps.taskId, action: operation.action, consumesReview: false })
    return next
  })
  const parse = text => parseJsonValue(text).summary.trim()
  const result = await runTextNodes({ target: 'project-summary',
    prompts: buildTextPrompts({ skill: 'project-summary', project }),
    options: { route: modelRoutes(await models.read()).story, project, fetchImpl: deps.fetchImpl, request: deps.request },
    check: text => projectSummaryFailures(parseJsonValue(text)),
    persist: (text, check) => projects.save(project.id, current => {
      const next = structuredClone(current)
      setContent(next.summary, parse(text), check)
      return next
    }),
  })
  await projects.save(project.id, current => { const next = structuredClone(current); finish(next.summary, result.check); return next })
  trace.result = { summary: parse(result.text) }
  return trace
}
