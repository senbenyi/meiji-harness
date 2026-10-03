// 操作：移除参考图
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { plotPatch } from '../../../../shared/drama-model.js'
import { clearCharacterReference } from '../../../../shared/image-assets.js'
import { visualPlace } from '../shared/image-files.js'
import { saveStep } from '../plan-steps.js'

export async function opClearReference(c) {
  let { operation, home, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以移除参考图'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  await Promise.all(['png', 'jpg', 'webp'].map(ext => rm(join(directory, `${item.id}-ref.${ext}`), { force: true })))
  const bag = clearCharacterReference(place.bag, item.id)
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }) })
  note(`已移除 ${item.name} 的参考图`)
  return trace
}

export const operations = {
  'clear-reference': { label: '移除参考图', scope: 'episode', queue: 'text', agent: false, step: saveStep(null), stage: 'episode', run: opClearReference },
}
