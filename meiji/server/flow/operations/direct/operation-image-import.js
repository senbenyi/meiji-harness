// 操作：导入图片
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { plotPatch } from '../../../../shared/drama-model.js'
import { staleMedia } from '../../../../shared/project-rules.js'
import { decodeImageData } from '../../../media/decode-image-data.js'
import { importAssetImage, visualPlace } from '../shared/image-files.js'
import { openIncoming } from '../shared/incoming.js'
import { saveStep } from '../plan-steps.js'

// if (operation.action === 'import-image')
export async function opImportImage(c) {
  let { operation, home, projects, models, project, trace, note } = c
  const place = visualPlace(project, operation.itemId)
  if (!place) throw Object.assign(new Error('请先写好角色卡或场景卡'), { status: 409 })
  let bytes
  let mime
  if (operation.data) {
    const decoded = decodeImageData(operation.data, operation.mime)
    bytes = decoded.bytes
    mime = decoded.mime
  } else {
    const incoming = await openIncoming(home, operation.incomingId)
    bytes = await readFile(incoming.file)
    mime = incoming.mime
    await rm(incoming.directory, { recursive: true, force: true })
  }
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  const bag = await importAssetImage({
    assets: place.bag, itemId: operation.itemId, projectId: project.id, episodeId: project.episodeId, directory,
    bytes, mime, home,
  })
  await projects.save(project.id, { ...staleMedia(project), ...plotPatch(project, { [place.key]: bag }) })
  const item = bag.items.find(entry => entry.id === operation.itemId)
  note(`已用上传的文件替换 ${item?.id || operation.itemId} ${item?.name || ''}`.trim())
  return trace
}

export const operations = {
  'import-image': { label: '导入图片', scope: 'episode', queue: 'text', agent: false, step: saveStep(null), stage: 'episode', run: opImportImage },
}
