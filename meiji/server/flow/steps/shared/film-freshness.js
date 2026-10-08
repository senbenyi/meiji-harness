import { GenerationStatus } from '../../../../shared/drama-model.js'
import { h3PromptFailures } from '../../../../shared/video-rules.js'
import { storyboardPromptText } from '../../../../shared/story-content.js'
import { previousTail } from '../../../../shared/tail-frame.js'
import { compileVideoPrompt } from '../../../prompts/video-prompt-renderer.js'
export const videoReady = shot => shot?.video.content?.status === 'ready'
export const tailReady = shot => shot?.tailFrame.status === GenerationStatus.PASSED && Boolean(shot.tailFrame.content?.localPath) && shot.tailFrame.content.sourceVideoFile === shot.video.content?.file
export function storyboardReady(project, track) {
  const shot = project.shots.items.find(item => item.id === track), board = shot?.storyboard.content
  if (!board) return false
  if (board.compilerVersion >= 1) {
    if (shot.seconds.check.passed !== true || board.secondsRevision !== shot.seconds.revision) return false
    try {
      const current = compileVideoPrompt(project, shot)
      if ((board.outfitSnapshot !== undefined || current.outfitSnapshot.length) && JSON.stringify(board.outfitSnapshot) !== JSON.stringify(current.outfitSnapshot)) return false
      if (JSON.stringify(board.referenceSnapshot) !== JSON.stringify(current.referenceSnapshot)) return false
      if ((board.compilerVersion >= 2 || current.characterSnapshot.some(person => person.voiceDescription)) && JSON.stringify(board.characterSnapshot) !== JSON.stringify(current.characterSnapshot)) return false
    } catch { return false }
  }
  const tail = previousTail(project, track)
  return board?.video !== 'first_frame' && shot.storyboard.status === GenerationStatus.PASSED && !h3PromptFailures(storyboardPromptText(board), board?.referenceSnapshot || [], board?.video || 'text').length && (tail?.sourceVideoFile || null) === (board?.tailReference?.sourceVideoFile || null)
}
