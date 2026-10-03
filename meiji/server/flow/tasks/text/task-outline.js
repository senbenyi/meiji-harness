import { modelRoutes } from '../../../../models/model-config.js'
import { runTextNodes } from '../../../runtime/text-generation.js'
import { checkContext } from '../../../runtime/operation-context.js'
import { buildStoryPrompts } from '../../../prompts/story-prompts.js'
import { parseJsonValue } from '../../../gateway/model-gateway.js'
import { normalizeOutline } from '../../../../shared/story-outline.js'
import { contentNode, plotPatch } from '../../../../shared/drama-model.js'

export async function runOutline({ operation, deps, projects, models, project, trace }) {
  const parse = text => normalizeOutline(parseJsonValue(text))
  const persist = (text, check) => projects.save(project.id, current => plotPatch(current, { outline: contentNode(current.plot.outline, parse(text), check) }))
  const result = await runTextNodes({ target: 'outline', prompts: buildStoryPrompts(project, 'outline'),
    options: { route: modelRoutes(await models.read()).story, project, fetchImpl: deps.fetchImpl, request: deps.request },
    check: text => { parse(text); return [] }, canPersist: text => { parse(text); return true }, retainFailedDraft: true, persist })
  checkContext.getStore().storyStages = true
  await persist(result.text, result.check)
  return trace
}
