import { runNode } from '../../runtime/task-execution.js'
import { referenceImageData } from '../../data/image-storage.js'
import { filmSubmit, prepareFilmOpening, submitFilm } from './shared/video-submit.js'

export const submitVideo = ({ project, item, track, home, projects, route, deps, size, images }) => runNode('video_submit', async () => {
  const payload = filmSubmit(project, item, await prepareFilmOpening(project, item, { home, projects, route, deps }))
  const media = payload.mode === 'reference' ? await referenceImageData(home, project, images) : []
  const queued = await submitFilm(project, track, payload, route, deps, size, media)
  return { queued, payload }
}, { target: `film:${track}` })
