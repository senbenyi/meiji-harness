import { GenerationStatus } from '../../shared/drama-model.js'
import { projectStore } from '../data/projects.js'
import { materialize } from '../data/episodes.js'
import { previousTail } from '../../shared/tail-frame.js'

const active = new Set()
export async function produceShots(operation, deps, run) {
  const key = `${deps.home}:${operation.projectId}:${operation.episodeId}`
  if (active.has(key)) throw new Error('本集成片流程正在执行')
  active.add(key)
  const read = async () => materialize(await projectStore(deps.home).read(operation.projectId), operation.episodeId)
  const trace = []
  try {
    const project = await read()
    const ids = operation.action === 'produce-all' ? project.shots.items.map(s => s.id) : [operation.track]
    for (const track of ids) {
      deps.signal?.throwIfAborted()
      let current = await read(), shot = current.shots.items.find(s => s.id === track)
      if (!shot) throw new Error('镜头不存在')
      const tail = previousTail(current, track)
      const bound = shot.storyboard.content?.tailReference
      const referenceChanged = (tail?.sourceVideoFile || null) !== (bound?.sourceVideoFile || null)
      if (shot.storyboard.content?.video === 'first_frame' || shot.storyboard.status !== GenerationStatus.PASSED || shot.storyboard.stale || referenceChanged) {
        trace.push(...await run({ ...operation, action: 'shot-storyboard', track }, deps))
        current = await read(); shot = current.shots.items.find(s => s.id === track)
        if (shot.storyboard.content?.video === 'first_frame' || shot.storyboard.status !== GenerationStatus.PASSED) throw new Error(`${track} 文本分镜未通过自审`)
      }
      if (shot.video.content?.status !== 'ready' || shot.video.stale) {
        trace.push(...await run({ ...operation, action: 'film', track }, { ...deps, waitForBackground: true }))
        shot = (await read()).shots.items.find(s => s.id === track)
        if (shot.video.content?.status !== 'ready') throw new Error(shot.video.content?.error || `${track} 视频未完成`)
      }
    }
    trace.status = 'completed'
    return trace
  } finally { active.delete(key) }
}
