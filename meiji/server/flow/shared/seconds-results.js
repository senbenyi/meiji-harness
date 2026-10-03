// 共享函数：任务与操作共用
import { saveTaskDraft } from '../../data/content-records.js'
import { activeNode } from '../../runtime/task-context.js'
import { setContent } from '../../../shared/drama-model.js'
import { clearShotDownstream } from '../../../shared/project-rules.js'

export async function retainSecondsResponse(text) {
  if (activeNode()) await saveTaskDraft('seconds-response', { text })
  return text
}

// 本镜更新会影响后镜连续性；保留后镜旧稿供修改，但清除其下游并标为过期。
export function saveSecondsShot(project, shots, track) {
  let next = project
  const index = project.shots.items.findIndex(shot => shot.id === track)
  for (const shot of project.shots.items.slice(index)) next = { ...next, ...clearShotDownstream(next, 'seconds', shot.id) }
  next.shots.items[index].seconds = shots.items.find(shot => shot.id === track).seconds
  for (const shot of next.shots.items.slice(index + 1)) {
    shot.seconds.stale = Boolean(shot.seconds.content)
    shot.seconds.check = { passed: null, failures: [] }
  }
  next.shots.seconds = setContent(structuredClone(next.shots.seconds), { version: 1, shots: next.shots.items.map(shot => shot.seconds.content).filter(Boolean) }, { passed: null, failures: [] })
  return { shots: next.shots, assembly: next.assembly, pendingImages: next.pendingImages }
}
