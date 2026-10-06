import { modelRoutes } from '../../../models/model-config.js'
import { finish, modelPatch } from '../../../shared/drama-model.js'
import { requireStepContent, textStepNode } from '../../../shared/text-step-target.js'
import { mergeLibraryGroup } from '../../../shared/library-rules.js'
import { reviewContent } from '../steps/step-review-edited-content.js'
import { storyboardPromptText } from '../../../shared/story-content.js'

// 审核读取已保存的正文，只保存结论；不进入生成准备、下游清理或自动修订。
// 本次目标提交的意见在审核通过后清除；失败保留，执行期间新输入的意见不清除。
const consume = (node, submitted) => { if (submitted && node.review.text === submitted) node.review = { ...node.review, text: '', revision: node.review.revision + 1 } }
function settle(node, check, submitted) {
  finish(node, check)
  if (check.passed) consume(node, submitted)
}
export async function runContentReview({ operation, deps, project, projects, models, trace }) {
  const target = deps.task.target, node = requireStepContent(project, target, operation.episodeId)
  if (target.startsWith('storyboard:')) {
    const check = await (deps.reviewContent || reviewContent)({ project, stage: 'storyboard', shotId: operation.track, text: storyboardPromptText(node.content), route: modelRoutes(await models.read()).story, request: deps.request })
    await projects.save(project.id, current => { const next = structuredClone(current); settle(textStepNode(next, target, operation.episodeId), check, operation.review); return next })
    trace.result = { step: 'review', stepCompleted: true, reviewPassed: check.passed }
    return trace
  }
  const steps = deps.task.steps, input = steps.reviewInput(project, operation, node)
  // 复审对照本轮修订：基稿取自修订步骤开始前的正文，意见为触发修订的审核结论或用户意见。
  const revise = deps.step?.kind === 're_review' ? deps.run.steps.find(item => item.id === deps.step.after[0] && item.kind === 'revise') : null
  const feedback = revise?.input?.feedback
  const revision = revise?.output?.revisionBase ? { baseContent: revise.output.revisionBase, revisionOpinion: feedback ? JSON.stringify({ passed: feedback.passed, issues: feedback.issues }) : operation.review || '', revisionReview: true } : undefined
  const result = await steps.review({ ...input, revision, target,
    options: { route: modelRoutes(await models.read()).story, project, shotId: operation.track, request: deps.request, fetchImpl: deps.fetchImpl, logStage: '审核' },
    persist: async result => projects.save(project.id, current => {
      const next = structuredClone(current), targetNode = textStepNode(next, target, operation.episodeId)
      settle(targetNode, result.check, operation.review)
      // 整集意见在全部镜头通过后清除。
      if (target.startsWith('seconds:') && result.check.passed) { const view = next.episodes ? next.episodes.find(item => item.id === operation.episodeId) : next; if (view.shots.items.every(shot => shot.seconds.check.passed === true)) consume(view.shots.seconds, operation.review || deps.run?.goal?.feedback) }
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
