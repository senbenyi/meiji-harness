import { GenerationStatus, node } from './content-node.js'

// 人物、场景、道具卡片。图片和附属槽位各是一个内容节点。
export function cardModel(fields) {
  const { id, image, localPath, assetId, assetCategory, ...data } = fields
  const media = image || node(`image:${id}`, localPath || assetId ? { localPath, assetId, assetCategory } : null)
  if (media.content?.localPath || media.content?.assetId) { media.status = GenerationStatus.PASSED; media.check.passed = true }
  return { ...node(id), ...data, image: media, parts: data.parts || Object.fromEntries(['clothes', 'props', 'hairstyles'].map(slot => [slot, node(`image:${id}:${slot}`)])) }
}
