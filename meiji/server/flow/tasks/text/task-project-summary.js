import { modelRoutes } from '../../../../models/model-config.js'
import { begin, finish, setContent } from '../../../../shared/drama-model.js'
import { projectSummaryFailures } from '../../../../shared/script-content.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { buildTextPrompts } from '../../../prompts/text-prompts.js'
import { runTextNodes } from '../../../runtime/text-generation.js'

export async function runProjectSummary({ operation, deps, projects, models, project, trace }) {
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
