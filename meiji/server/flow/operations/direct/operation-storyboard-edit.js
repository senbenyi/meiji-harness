// 操作：编辑文本分镜
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { runStep } from '../../../runtime/task-execution.js'
import { reviewContent } from '../../../runtime/text-generation.js'
import { storyboardTextPatch } from '../../../../shared/storyboard-edit.js'
import { editSteps } from '../plan-steps.js'

// if (operation.action === 'storyboard-text')
export async function opStoryboardText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  project = await runStep('save', () => projects.save(project.id, current => ({ ...storyboardTextPatch(current, operation) })), { target: `storyboard:${operation.track}` })
  const result = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: operation.text, route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, {}, { final: true })
  note(result.passed ? '文本分镜已保存并通过自检' : `文本分镜已保存，自检未通过：${result.failures.join('；')}`)
  return trace
}

export const operations = {
  'storyboard-text': { label: '编辑文本分镜', scope: 'shot', queue: 'text', agent: false, plan: (_, op) => editSteps(`storyboard:${op.track}`), stage: 'episode', run: opStoryboardText },
}
