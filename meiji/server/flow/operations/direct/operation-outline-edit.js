// 操作：修改大纲
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { runNode } from '../../../runtime/step-execution.js'
import { reviewContent } from '../../steps/step-review-edited-content.js'
import { plotPatch, contentNode } from '../../../models/data/drama-model.js'
import { editSteps } from '../../../../shared/task-plans.js'
import { normalizeOutline } from '../../../../shared/story-outline.js'

// if (operation.action === 'outline-text')
export async function opOutlineText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const outline = normalizeOutline(operation.outline, 400, project.durationSeconds)
  project = await runNode('save', () => projects.writeStep(project.id, 'outline', { ...plotPatch(project, { outline: { ...contentNode(project.plot.outline, outline), sourceMode: 'manual' } }) }), { target: 'outline' })
  if (deps.deferReview) { note('大纲已保存，等待复审或人工通过'); return trace }
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'outline', text: JSON.stringify(outline), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, {}, { final: true })
  note(result.passed ? '大纲已保存并通过自检' : `大纲已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

export const operations = {
  'outline-text': { label: '修改大纲', scope: 'episode', agent: false, plan: () => editSteps('outline'), stage: 'episode', run: opOutlineText },
}
