// 共享函数：任务与操作共用
import { saveTaskDraft } from '../../data/content-records.js'
import { activeNode } from '../../runtime/task-context.js'
import { setContent } from '../../../shared/drama-model.js'

export async function retainSecondsResponse(text) {
  if (activeNode()) await saveTaskDraft('seconds-response', { text })
  return text
}

// 本镜更新保留当前结果，删除后镜旧指令及受影响媒体。
export function saveSecondsShot(project, shots, track) {
  const next = structuredClone(project)
  const index = next.shots.items.findIndex(shot => shot.id === track)
  next.shots.items[index].seconds = shots.items.find(shot => shot.id === track).seconds
  next.shots.seconds = setContent(structuredClone(next.shots.seconds), { version: 1, shots: next.shots.items.map(shot => shot.seconds.content).filter(Boolean) }, { passed: null, failures: [] })
  return { shots: next.shots, assembly: next.assembly, pendingImages: next.pendingImages }
}
