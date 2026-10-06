import { pictureOf } from './drama-model.js'
export function shotReferenceImages(project, item) {
  if (Array.isArray(item?.referenceSnapshot)) return item.referenceSnapshot.map(image => ({ ...image }))
  const images = []
  const add = (asset, label, kind, ownerId, slot) => {
    const url = pictureOf(asset).localPath || ''
    if (!url) return
    const key = pictureOf(asset).assetId || url
    if (images.some(image => (image.assetId || image.url) === key)) return
    images.push({ url, label, id: asset.id, name: asset.name, kind, ...(pictureOf(asset).assetId ? { assetId: pictureOf(asset).assetId, assetCategory: pictureOf(asset).assetCategory, localPath: pictureOf(asset).localPath } : {}), ...(ownerId ? { ownerId, ownerName: project.plot.characters.items.find(person => person.id === ownerId).name, slot } : {}) })
  }
  const names = Array.isArray(item?.characters) ? item.characters : (item?.cast || [])
  const people = names.map(name => project.plot.characters?.items?.find(person => person.name === name)).filter(Boolean)
  for (const person of people) add(person, `人物「${person.name}」`, 'characters')
  for (const name of item?.scenes || [item?.scene]) {
    const scene = project.plot.scenes?.items?.find(scene => scene.name === name)
    if (scene) add(scene, `场景「${scene.name}」`, 'scenes')
  }
  const selected = item?.reference_images
  if (images.length > 9) throw Object.assign(new Error('本镜参考图超过 9 张，请在文本分镜中选择实际使用的素材'), { status: 409 })
  return images
}
