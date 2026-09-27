import { targetNode, emptyCheck, emptyReview } from './drama-model.js'
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
  const record = targetNode(project, key)
  return record || emptyFeedback()
}
