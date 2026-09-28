import { GenerationStatus, allNodes, modelPatch } from '../../client/drama-model.js'
export async function interruptRunning(store) {
  for (const project of await store.list()) {
    await store.interruptRecords?.(project.id)
    if (!project.episodes.some(e => e.activity || allNodes(e).some(n => n.operation || n.status === GenerationStatus.GENERATING))) continue
    await store.save(project.id, current => ({ activity: null, activeOperation: null, episodes: current.episodes.map(episode => {
      const next = structuredClone(episode)
      for (const target of allNodes(next)) {
        if (target.operation?.phase === 'awaiting-confirmation' || (!target.operation && target.status !== GenerationStatus.GENERATING)) continue
        target.status = GenerationStatus.PAUSED; target.error = null; target.operation = null
        if (target.content?.status === 'running') target.content.status = 'interrupted'
      }
      next.activity = null
      next.activityError = null
      return modelPatch(episode, next)
    }) }))
  }
}
