// 操作：编辑文本分镜
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { runNode } from '../../../runtime/step-execution.js'
import { reviewContent } from '../../steps/step-review-edited-content.js'
import { storyboardTextPatch } from '../../../../shared/storyboard-edit.js'
import { editSteps } from '../../../../shared/task-plans.js'

// if (operation.action === 'storyboard-text')
export async function opStoryboardText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  project = await runNode('save', () => projects.save(project.id, current => ({ ...storyboardTextPatch(current, operation) })), { target: `storyboard:${operation.track}` })
  if (deps.deferReview) { note('文本分镜已保存，等待复审或人工通过'); return trace }
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: operation.text, route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, {}, { final: true })
  note(result.passed ? '文本分镜已保存并通过自检' : `文本分镜已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

export const operations = {
  'storyboard-text': { label: '编辑文本分镜', scope: 'shot', agent: false, plan: (_, op) => editSteps(`storyboard:${op.track}`), stage: 'episode', run: opStoryboardText },
}
