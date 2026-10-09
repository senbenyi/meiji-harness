import { checkContext } from '../../../runtime/operation-context.js'
import { markPendingReview } from '../../../models/tasks/content-state.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { begin, finish, setContent } from '../../../models/data/drama-model.js'
import { projectSummaryFailures } from '../../../../shared/script-content.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { promptsForProjectSummary } from '../../steps/step-generate-project-summary.js'
import { runTextNodes } from '../text-workflow.js'

export async function runProjectSummary({ operation, deps, projects, models, library, project, trace }) {
  await projects.save(project.id, current => {
    const next = structuredClone(current)
    begin(next.summary, { id: deps.writeToken, action: operation.action, consumesReview: false })
    return next
  })
  const parse = text => parseJsonValue(text).summary.trim()
  const result = await runTextNodes({ target: 'project-summary',
    prompts: promptsForProjectSummary(project, operation.step === 'revise', operation.review || operation.requirements),
    options: { route: modelRoutes(await models.read()).story, project, fetchImpl: deps.fetchImpl, request: deps.request },
    check: text => projectSummaryFailures(parseJsonValue(text)),
    persist: (text, check) => projects.save(project.id, current => {
      const next = structuredClone(current)
      setContent(next.summary, parse(text), check)
      return next
    }),
  })
  await projects.save(project.id, current => { const next = structuredClone(current); finish(next.summary, result.check); if (checkContext.getStore()?.step && result.check.passed == null) markPendingReview(next.summary); if (result.check.passed) next.summary.basis = { scriptRevision: project.scriptRevision }; return next })
  trace.result = { summary: parse(result.text) }
  return trace
}
