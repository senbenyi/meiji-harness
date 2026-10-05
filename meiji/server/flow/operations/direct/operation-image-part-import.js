// 操作：导入部件图片
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { plotPatch } from '../../../../shared/drama-model.js'
import { savePicture } from '../../../data/image-storage.js'
import { appendImageAsset, nextPartId, partSlots } from '../../../../shared/image-assets.js'
import { decodeImageData } from '../../../media/decode-image-data.js'
import { visualPlace } from '../../shared/image-files.js'
import { openIncoming } from '../../shared/incoming.js'
import { saveStep } from '../../../../shared/task-plans.js'

// if (operation.action === 'part-import')
export async function opPartImport(c) {
  let { operation, home, projects, models, project, trace, note } = c
  const slot = operation.slot
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const place = visualPlace(project, operation.itemId)
  const character = place?.bag.items.find(entry => entry.id === operation.itemId && entry.type === 'role')
  if (!character) throw Object.assign(new Error('只有人物可以添加衣服、坐骑、道具或发型'), { status: 400 })
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
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : ''
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  const partId = nextPartId(character, slot)
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', project.episodeId || '')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${partId}.${ext}`), bytes, { mode: 0o600 })
  const reference = await savePicture(home, bytes, mime, 'props', `${character.name}-${slot}`, { source: 'import', projectId: project.id, episodeId: project.episodeId, itemId: partId })
  const bag = appendImageAsset(place.bag, character.id, slot, {
    id: partId,
    name: `${partSlots[slot].label}${partId.slice(-2)}`,
    ...reference,
  })
  await projects.save(project.id, { ...plotPatch(project, { [place.key]: bag }) })
  note(`已导入 ${character.name} 的${partSlots[slot].label} ${partId}`)
  return trace
}

export const operations = {
  'part-import': { label: '导入图片', scope: 'episode', agent: false, step: saveStep(null), stage: 'episode', run: opPartImport },
}
