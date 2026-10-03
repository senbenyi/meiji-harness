// 操作：设置参考图
import { rm } from 'node:fs/promises'
import { clearCharacterReference } from '../../../../shared/image-assets.js'
import { join } from 'node:path'
import { plotPatch } from '../../../../shared/drama-model.js'
import { saveCharacterReference, visualPlace, readUploadedImage } from '../../shared/image-files.js'
import { saveStep } from '../../../../shared/task-plans.js'

export async function opSetReference(c) {
  let { operation, home, projects, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  const item = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!item) throw Object.assign(new Error('只有人物可以设置参考图'), { status: 400 })
  const { bytes, mime } = await readUploadedImage(operation, home)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const bag = await saveCharacterReference({
    assets: place.bag, itemId: item.id, projectId: project.id, episodeId: project.episodeId, directory, bytes, mime,
  })
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }) })
  note(`已设置 ${item.name} 的参考图`)
  return trace
}

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
  'set-reference': { label: '设置参考图', scope: 'episode', agent: false, step: saveStep(op => `image:${op.itemId}`), stage: 'episode', run: opSetReference },
  'clear-reference': { label: '移除参考图', scope: 'episode', agent: false, step: saveStep(op => `image:${op.itemId}`), stage: 'episode', run: opClearReference },
}
