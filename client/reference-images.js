export function shotReferenceImages(project, item) {
  if (Array.isArray(item?.referenceSnapshot)) return item.referenceSnapshot.map(image => ({ ...image }))
  const images = []
  const add = (asset, label, kind, ownerId, slot) => {
    const url = /^https?:\/\//.test(String(asset?.imageUrl || '')) ? asset.imageUrl : asset?.localPath || ''
    if (!url) return
    const key = asset.assetId || url
    if (images.some(image => (image.assetId || image.url) === key)) return
    images.push({ url, label, id: asset.id, name: asset.name, kind, ...(asset.assetId ? { assetId: asset.assetId } : {}), ...(ownerId ? { ownerId, ownerName: project.characters.items.find(person => person.id === ownerId).name, slot } : {}) })
  }
  const names = Array.isArray(item?.characters) ? item.characters : (item?.cast || [])
  const people = names.map(name => project.characters?.items?.find(person => person.name === name)).filter(Boolean)
  for (const person of people) add(person, `人物「${person.name}」`, 'characters')
  for (const name of item?.scenes || [item?.scene]) {
    const scene = project.scenes?.items?.find(scene => scene.name === name)
    if (scene) add(scene, `场景「${scene.name}」`, 'scenes')
  }
  const selected = item?.reference_images
  for (const person of people) {
    for (const [slot, label] of [['clothes', '服装'], ['props', '道具'], ['hairstyles', '发型']]) {
      for (const part of person[slot] || []) {
        const key = `${person.name}/${slot}/${part.id}`
        if (Array.isArray(selected) && !selected.some(ref => ref === key || ref === part.name || ref === part.assetId || ref === part.imageUrl)) continue
        add(part, `${person.name}的${label}「${part.name || part.id}」`, slot === 'props' ? 'props' : 'characters', person.id, slot)
      }
    }
  }
  if (images.length > 9) throw Object.assign(new Error('本镜参考图超过 9 张，请在文本分镜中选择实际使用的服装、道具和发型'), { status: 409 })
  return images
}

