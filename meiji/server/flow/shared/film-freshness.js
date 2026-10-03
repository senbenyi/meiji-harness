import { GenerationStatus } from '../../../shared/drama-model.js'
import { h3PromptFailures } from '../../../shared/video-rules.js'
import { storyboardPromptText } from '../../../shared/story-content.js'
import { previousTail } from '../../../shared/tail-frame.js'
export const videoReady = shot => shot?.video.content?.status === 'ready' && !shot.video.stale
export const tailReady = shot => shot?.tailFrame.status === GenerationStatus.PASSED && !shot.tailFrame.stale && Boolean(shot.tailFrame.content?.localPath) && shot.tailFrame.content.sourceVideoFile === shot.video.content?.file
export function storyboardReady(project, track) {
  const shot = project.shots.items.find(item => item.id === track), board = shot?.storyboard.content
  const tail = previousTail(project, track)
  return board?.video !== 'first_frame' && shot.storyboard.status === GenerationStatus.PASSED && !shot.storyboard.stale && !h3PromptFailures(storyboardPromptText(board), board?.referenceSnapshot || [], board?.video || 'text').length && (tail?.sourceVideoFile || null) === (board?.tailReference?.sourceVideoFile || null)
}
