import { runNode } from '../../runtime/step-execution.js'
import { saveLastFrame } from '../../media/extract-video-tail.js'
import { saveTailFrame } from './shared/video-submit.js'

export const extractTailFrame = ({ projects, project, track, file, directory, home, deps }) => runNode('tail_frame',
  () => saveTailFrame(projects, project, track, file, directory, home, deps.saveLastFrame || saveLastFrame),
  { target: `film:${track}` })
