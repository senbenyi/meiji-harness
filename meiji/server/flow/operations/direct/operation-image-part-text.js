// 操作：编辑图片描述
import { plotPatch } from '../../../../shared/drama-model.js'
import { partSlots, withPartText } from '../../../../shared/image-assets.js'
import { visualPlace } from '../../shared/image-files.js'
import { saveStep } from '../../../../shared/task-plans.js'

export async function opPartText(c) {
  let { operation, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以编辑这类描述'), { status: 400 })
  const next = withPartText(item, operation.slot, operation.text)
  const bag = { ...place.bag, items: place.bag.items.map(entry => entry.id === item.id ? next : entry) }
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }) })
  note(`已保存 ${item.name} 的${partSlots[operation.slot]?.label || ''}描述`)
  return trace
}

export const operations = {
  'part-text': { label: '编辑图片描述', scope: 'episode', agent: false, step: saveStep(null), stage: 'episode', run: opPartText },
}
