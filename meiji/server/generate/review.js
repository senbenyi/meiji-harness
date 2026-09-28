import { runReviewNode } from '../flow/text-workflow.js'
import { buildEditedContentReview } from '../prompts/text-prompts.js'

export async function reviewContent({ project, stage, shotId, text, route, request }) {
  const result = await runReviewNode({ message: buildEditedContentReview({ project, stage, shotId }, text), options: { project, route, request, maxTokens: 4096, logStage: '自审' } })
  return result.check
}
