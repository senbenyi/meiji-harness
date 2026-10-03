// 操作：设置参考图
import { join } from 'node:path'
import { plotPatch } from '../../../../../shared/drama-model.js'
import { saveCharacterReference, visualPlace, readUploadedImage } from '../../shared/image-files.js'
import { saveStep } from '../../plan-steps.js'

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
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note(`已设置 ${item.name} 的参考图`)
  return trace
}

export const operations = {
  'set-reference': { label: '设置参考图', scope: 'episode', queue: 'text', agent: false, step: saveStep(null), stage: 'episode', run: opSetReference },
}
