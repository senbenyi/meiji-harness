import { pictureOf, node, setContent } from './drama-model.js'
import { characterFieldValues, characterLookText } from './character-facts.js'

export function usableLook(text) {
  const look = String(text || '').replace(/\s+/g, ' ').trim()
  const han = look.match(/[\p{L}\p{N}]/gu) || []
  return han.length >= 12 ? look : ''
}

export function imagePrompt(item) {
  const look = usableLook(item?.look)
  if (!look) throw Object.assign(new Error(`${item?.name || '资产'}还没有可用的画面提示词`), { status: 400 })
  return look
}

export function sceneStillPrompt(item) {
  const look = usableLook(item?.look) || String(item?.look || '').trim()
  if (!look) throw Object.assign(new Error(`${item?.name || '场景'}还没有可用的画面提示词`), { status: 400 })
  return look
}

export function assetImageUrl(projectId, itemId, version = Date.now(), episodeId = '') {
  return `/plugins/meiji/projects/${projectId}/images/${encodeURIComponent(itemId)}?${episodeId ? `episodeId=${encodeURIComponent(episodeId)}&` : ''}v=${version}`
}

export function pictureRecord(item) {
  if (!item || typeof item !== 'object') return item
  const localPath = item.localPath || null
  if (['role', 'scene', 'prop'].includes(item.type)) {
    const { localPath: _, assetId, assetCategory, prompt, ...card } = item
    const media = { ...pictureOf(item), ...(prompt ? { prompt } : {}), localPath: localPath || pictureOf(item).localPath || null, ...(assetId ? { assetId, assetCategory } : {}) }
    card.image = setContent(structuredClone(item.image || node(`image:${item.id}`)), media, { passed: Boolean(media.localPath || media.assetId), failures: [] })
    return card
  }
  return { ...item, localPath }
}

export function imageAsset(item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || '').trim()
  const name = String(item.name || '').trim()
  if (!id || !name) return null
  const pictured = pictureRecord(item)
  return { id, name, ...(pictured.prompt ? { prompt: pictured.prompt } : {}), ...(pictured.assetId ? { assetId: pictured.assetId, assetCategory: pictured.assetCategory } : {}), localPath: pictured.localPath || null }
}

export function imageAssets(list) {
  return (Array.isArray(list) ? list : []).map(imageAsset).filter(Boolean)
}

export const partSlots = {
  clothes: { mark: 'W', label: '衣服' },
  mounts: { mark: 'M', label: '坐骑' },
  props: { mark: 'P', label: '道具' },
  hairstyles: { mark: 'H', label: '发型' },
}

export function nextPartId(character, slot) {
  const spec = partSlots[slot]
  if (!spec || !character?.id) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const used = new Set(imageAssets(character[slot]).map(item => item.id))
  let index = used.size + 1
  let id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  while (used.has(id)) {
    index += 1
    id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  }
  return id
}

export const partTextFields = {
  clothes: 'costume',
  mounts: 'mount',
  props: 'prop',
  hairstyles: 'hairstyle',
}

export function partNoteText(character, slot) {
  if (slot === 'clothes') return characterFieldValues(character).costume
  const key = partTextFields[slot]
  return key ? String(character?.[key] || '').trim() : ''
}

export function withPartText(character, slot, text) {
  const key = partTextFields[slot]
  if (!key) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const value = String(text ?? '').trim()
  if (value.length > 10000) throw Object.assign(new Error('描述不能超过10000字'), { status: 400 })
  const next = { ...character, [key]: value }
  if (slot === 'clothes') next.look = characterLookText({ ...characterFieldValues(character), costume: value })
  return next
}

export function partPrompt(character, slot) {
  const background = '灰白纯色背景'
  const note = partNoteText(character, slot)
  if (slot === 'clothes') return `${note || '衣服'}。单独展示这套衣服，不要画人，${background}`
  if (slot === 'mounts') return `${note || '坐骑'}。单独展示这只坐骑，不要画人，${background}`
  if (slot === 'props') return `${note || '道具'}。单独展示这件道具，不要画人，${background}`
  if (slot === 'hairstyles') return `${note || '发型'}。只画这款发型，不要画全身，${background}`
  throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
}

export function appendImageAsset(assets, characterId, slot, asset) {
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const picture = imageAsset(asset)
  if (!picture) throw Object.assign(new Error('图片资源缺少编号或名称'), { status: 400 })
  let found = false
  const items = (assets?.items || []).map(entry => {
    if (entry.id !== characterId || entry.type !== 'role') return entry
    found = true
    const list = imageAssets(entry[slot]).filter(item => item.id !== picture.id)
    return { ...entry, [slot]: [...list, picture] }
  })
  if (!found) throw Object.assign(new Error('只有人物可以添加衣服、坐骑、道具或发型'), { status: 400 })
  return { ...assets, items }
}

export function clearCharacterImage(assets, itemId) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以删除绑定图片'), { status: 400 })
  const items = assets.items.map(entry => {
    if (entry.id !== itemId) return entry
    return { ...entry, image: node(`image:${entry.id}`) }
  })
  return { ...assets, items }
}

export function clearCharacterReference(assets, itemId) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以移除参考图'), { status: 400 })
  return { ...assets, items: assets.items.map(entry => entry.id === itemId ? { ...entry, reference: null } : entry) }
}
