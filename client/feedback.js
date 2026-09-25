// Every workflow target uses the same check/review record, scoped to one episode.
export function feedbackKey({ action, track, itemId, slot }) {
  if (action === 'episode-generate') return 'summary'
  if (action === 'revise-shot') return `shot:${track}`
  if (action === 'shot-seconds') return `seconds:${track}`
  if (action === 'shot-storyboard') return `storyboard:${track}`
  if (action === 'shot-boards') return 'storyboard'
  if (action === 'revise-image' || action === 'image') return `image:${itemId}`
  if (action === 'part-image') return `image:${itemId}:${slot}`
  if (action === 'pencil' || action === 'film') return `${action}:${track}`
  if (action === 'assemble') return 'assembly'
  return action
}

export function emptyFeedback() {
  return { check: { passed: null, failures: [] }, review: { status: 'pending', text: '', history: [] } }
}

export function feedbackOf(project, target) {
  return project?.feedback?.[typeof target === 'string' ? target : feedbackKey(target)] || emptyFeedback()
}
