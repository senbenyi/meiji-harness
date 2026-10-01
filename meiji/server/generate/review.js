import { h3PromptFailures } from './film.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { reviewStep } from './text-steps.js'
import { buildEditedContentReview } from '../prompts/text-prompts.js'

export async function reviewContent({ project, stage, shotId, text, route, request }) {
  const board = project.shots?.items.find(shot => shot.id === shotId)?.storyboard.content
  const check = stage === 'storyboard' && board ? value => h3PromptFailures(value, shotReferenceImages(project, board), board.video) : undefined
  const result = await reviewStep({ check, text, target: shotId ? `storyboard:${shotId}` : 'story', message: buildEditedContentReview({ project, stage, shotId }, text), options: { project, route, request, logStage: '自审' } })
  return result.check
}
