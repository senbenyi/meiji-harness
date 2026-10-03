import { videoReady } from '../../shared/film-freshness.js'
import { opFilm, opTailFrame } from '../../shared/video-submit.js'
export async function runVideo(context) {
  const shot = context.project.shots.items.find(item => item.id === context.operation.track)
  return context.operation.parts === 'tail' || !context.operation.parts && videoReady(shot) ? opTailFrame(context) : opFilm(context)
}
