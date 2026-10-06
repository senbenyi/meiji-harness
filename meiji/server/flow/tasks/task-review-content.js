import { modelRoutes } from '../../../models/model-config.js'
import { finish, modelPatch } from '../../../shared/drama-model.js'
import { requireStepContent, textStepNode } from '../../../shared/text-step-target.js'
import { mergeLibraryGroup } from '../../../shared/library-rules.js'
import { reviewContent } from '../steps/step-review-edited-content.js'
import { storyboardPromptText } from '../../../shared/story-content.js'

// 审核读取已保存的正文，只保存结论；不进入生成准备、下游清理或自动修订。
export async function runContentReview({ operation, deps, project, projects, models, trace }) {
  const target = deps.task.target, node = requireStepContent(project, target, operation.episodeId)
  if (target.startsWith('storyboard:')) {
    const check = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: storyboardPromptText(node.content), route: modelRoutes(await models.read()).story, request: deps.request })
    await projects.save(project.id, current => { const next = structuredClone(current); finish(textStepNode(next, target, operation.episodeId), check); return next })
    trace.result = { step: 'review', stepCompleted: true, reviewPassed: check.passed }
    return trace
  }
  const steps = deps.task.steps, input = steps.reviewInput(project, operation, node)
  const result = await steps.review({ ...input, target,
    options: { route: modelRoutes(await models.read()).story, project, shotId: operation.track, request: deps.request, fetchImpl: deps.fetchImpl, logStage: '审核' },
    persist: async result => projects.save(project.id, current => {
      const next = structuredClone(current), targetNode = textStepNode(next, target, operation.episodeId)
      finish(targetNode, result.check)
      if (target === 'project-summary' && result.check.passed) targetNode.basis = { scriptRevision: current.scriptRevision }
      if (['characters', 'scenes', 'props'].includes(target) && result.check.passed && targetNode.items.some(item => !item.ref)) {
        const published = mergeLibraryGroup(next, target, targetNode)
        // 发布库关联不覆盖本次受审正文或现有图片。
        published.plot[target].items = targetNode.items.map((item, index) => ({ ...item, ref: published.plot[target].items[index].ref }))
        return published
      }
      return next.episodes ? next : modelPatch(current, next)
    }) })
  trace.result = { step: 'review', stepCompleted: true, reviewPassed: result.check.passed }
  return trace
}
