import { GenerationStatus } from './drama-model.js'
export function previousTail(project, shotId) {
  const index = project.shots.items.findIndex(s => s.id === shotId)
  const previous = project.shots.items[index - 1]
  const frame = previous?.tailFrame
  if (!previous || previous.video.stale || previous.video.content?.status !== 'ready' || frame?.status !== GenerationStatus.PASSED || frame.content?.sourceVideoFile !== previous.video.content?.file || !frame.content?.imageUrl) return null
  return { ...frame.content, sourceShotId: previous.id }
}
