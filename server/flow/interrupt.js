const interrupted = '生成已中断，可以重新生成'

function interruptFields(bag) {
  const next = {}
  let changed = false
  const films = bag?.films
  if (films && typeof films === 'object') {
    const copy = { ...films }
    for (const [track, clip] of Object.entries(copy)) {
      if (clip?.status !== 'running') continue
      copy[track] = { ...clip, status: 'interrupted', error: interrupted }
      changed = true
    }
    if (changed) next.films = copy
  }
  if (bag?.activity) {
    next.activity = null
    next.activityError = interrupted
    changed = true
  }
  return changed ? next : null
}

export async function interruptRunning(store) {
  const projects = await store.list()
  for (const project of projects) {
    const patch = interruptFields(project) || {}
    let episodesChanged = false
    const episodes = (project.episodes || []).map(episode => {
      const next = interruptFields(episode)
      if (!next) return episode
      episodesChanged = true
      return { ...episode, ...next }
    })
    if (episodesChanged) patch.episodes = episodes
    if (Object.keys(patch).length) await store.save(project.id, patch)
  }
}
