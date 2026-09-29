import { reviewStep } from './text-steps.js'
import { buildEditedContentReview } from '../prompts/text-prompts.js'

export async function reviewContent({ project, stage, shotId, text, route, request }) {
  const result = await reviewStep({ target: shotId ? `storyboard:${shotId}` : 'story', message: buildEditedContentReview({ project, stage, shotId }, text), options: { project, route, request, logStage: '自审' } })
  return result.check
}
