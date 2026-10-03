// 操作：关联图片素材
import { plotPatch } from '../../../../../shared/drama-model.js'
import { pictureReference } from '../../../../data/image-storage.js'
import { pictureRecord } from '../../../../../shared/image-assets.js'
import { staleMedia } from '../../../../../shared/project-rules.js'
import { visualPlace } from '../../shared/image-files.js'
import { saveStep } from '../../plan-steps.js'

// if (operation.action === 'use-asset')
export async function opUseAsset(c) {
  let { operation, projects, library, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('人物或场景不存在'), { status: 404 })
  const file = await library.file(operation.category, operation.assetId)
  if (!file.metadata.mime.startsWith('image/')) throw Object.assign(new Error('请选择图片素材'), { status: 400 })
  const bag = { ...place.bag, items: place.bag.items.map(item => item.id === operation.itemId
    ? pictureRecord({ ...item, ...pictureReference(file.metadata) }) : item) }
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }), activity: null, activityError: null })
  note('已关联素材 ' + file.metadata.id)
  return trace
}

export const operations = {
  'use-asset': { label: '关联图片素材', scope: 'episode', queue: 'text', agent: false, step: saveStep(null), stage: 'episode', run: opUseAsset },
}
