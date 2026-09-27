import { allNodes, modelPatch } from '../../client/drama-model.js'
export async function interruptRunning(store) {
  for (const project of await store.list()) {
    if (!project.episodes.some(e => e.activity || allNodes(e).some(n => n.operation || n.status === 'generating'))) continue
    await store.save(project.id, current => ({ activity: null, activeOperation: null, episodes: current.episodes.map(episode => {
      const next = structuredClone(episode)
      for (const target of allNodes(next)) {
        if (target.operation?.phase === 'awaiting-confirmation' || (!target.operation && target.status !== 'generating')) continue
        target.status = 'failed'; target.error = '生成已中断，可以重新生成'; target.operation = null
        if (target.content?.status === 'running') target.content.status = 'interrupted'
      }
      next.activity = null
      return modelPatch(episode, next)
    }) }))
  }
}
