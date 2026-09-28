import { targetNode, emptyCheck, emptyReview, node, aggregateStatus } from './drama-model.js'
export function feedbackKey({ action, track, itemId, slot }) {
  if (action === 'scene-text') return 'scenes'
  if (action === 'episode-generate') return 'summary'
  if (action === 'revise-shot') return `shot:${track}`
  if (action === 'shot-seconds') return `seconds:${track}`
  if (action === 'shot-storyboard' || action === 'storyboard-text') return `storyboard:${track}`
  if (action === 'shot-boards') return 'storyboard'
  if (action === 'revise-image' || action === 'image') return `image:${itemId}`
  if (action === 'part-image') return `image:${itemId}:${slot}`
  if (action === 'pencil' || action === 'film') return `${action}:${track}`
  if (action === 'assemble') return 'assembly'
  return action
}
export function emptyFeedback() { return { check: emptyCheck(), review: emptyReview() } }
export function feedbackOf(project, target) {
  const key = typeof target === 'string' ? target : feedbackKey(target)
  if (key === 'seconds') {
    const shots = project.shots?.items || []
    const group = project.shots?.seconds || node('seconds')
    const failures = shots.flatMap(shot => shot.seconds.check.passed === false ? shot.seconds.check.failures.map(reason => `${shot.id}：${reason}`) : [])
    const errors = shots.filter(shot => shot.seconds.error).map(shot => `${shot.id}：${shot.seconds.error}`)
    return { ...group, canModify: shots.length > 0 && shots.every(shot => Boolean(shot.seconds.content)), status: group.operation || group.status === 'paused' ? group.status : aggregateStatus(shots.map(shot => shot.seconds)),
      check: { passed: failures.length ? false : shots.length && shots.every(shot => shot.seconds.check.passed === true) ? true : null, failures },
      error: group.error || errors.join('；') || null }
  }
  const record = targetNode(project, key)
  return record || emptyFeedback()
}
