import { modelRoutes } from '../../../../models/model-config.js'
import { runTextNodes } from '../text-workflow.js'
import { checkContext } from '../../../runtime/operation-context.js'
import { promptsForOutline, parseOutline } from '../../steps/step-generate-outline.js'
import { contentNode, plotPatch } from '../../../../shared/drama-model.js'

export async function runOutline({ operation, deps, projects, models, project, trace }) {
  const parse = parseOutline
  const persist = (text, check) => projects.save(project.id, current => plotPatch(current, { outline: contentNode(current.plot.outline, parse(text), check) }))
  const result = await runTextNodes({ target: 'outline', prompts: promptsForOutline(project),
    options: { route: modelRoutes(await models.read()).story, project, fetchImpl: deps.fetchImpl, request: deps.request },
    check: text => { parse(text); return [] }, canPersist: text => { parse(text); return true }, retainFailedDraft: true, persist })
  checkContext.getStore().storyStages = true
  await persist(result.text, result.check)
  return trace
}
