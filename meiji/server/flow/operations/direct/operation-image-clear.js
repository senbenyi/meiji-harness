// 操作：删除图片
import { plotPatch } from '../../../../shared/drama-model.js'
import { clearCharacterImage } from '../../../../shared/image-assets.js'
import { visualPlace } from '../../shared/image-files.js'
import { saveStep } from '../../../../shared/task-plans.js'

// if (operation.action === 'clear-image')
export async function opClearImage(c) {
  let { operation, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('请先写好角色卡'), { status: 409 })
  const bag = clearCharacterImage(place.bag, operation.itemId)
  // Detach only: old images may still be referenced by other projects or videos.
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }) })
  const item = bag.items.find(entry => entry.id === operation.itemId)
  note(`已删除 ${item?.id || operation.itemId} ${item?.name || ''} 的绑定图片`.trim())
  return trace
}

export const operations = {
  'clear-image': { label: '删除图片', scope: 'episode', linkedCard: true, agent: false, step: saveStep(null), stage: 'episode', run: opClearImage },
}
