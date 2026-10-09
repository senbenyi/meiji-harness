import { checkOutline } from './step-review-outline.js'
import { reviewStep } from './shared/text-review.js'
import { h3PromptFailures } from '../../../shared/video-rules.js'
import { shotReferenceImages } from '../../../shared/reference-images.js'
import { buildEditedContentReview } from '../../prompts/text-prompts.js'

export async function reviewContent({ project, stage, shotId, text, route, request }) {
  const board = project.shots?.items.find(shot => shot.id === shotId)?.storyboard.content
  const check = stage === 'outline' ? value => checkOutline(value, project) : stage === 'storyboard' && board ? value => h3PromptFailures(value, shotReferenceImages(project, board), board.video) : undefined
  const result = await reviewStep({ check, text, target: shotId ? `storyboard:${shotId}` : stage, message: buildEditedContentReview({ project, stage, shotId }, text), options: { project, route, request, logStage: '自审' } })
  return result.check
}

