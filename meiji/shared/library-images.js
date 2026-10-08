import { libraryTarget } from './library-rules.js'
import { pictureOf } from './drama-model.js'
export function imageItems(project, episode, itemIds) {
  if (itemIds && (!Array.isArray(itemIds) || itemIds.some(id => typeof id !== 'string') || new Set(itemIds).size !== itemIds.length)) throw Object.assign(new Error('图片目标不存在或重复'), { status: 400 })
  const selected = itemIds?.length ? new Set(itemIds) : null
  const cards = ['characters', 'scenes', 'props'].flatMap(kind => (episode.plot[kind]?.items || []).map(card => ({ kind, card }))).filter(({ kind, card }) => !(kind === 'characters' && card.presence === 'voice') && (!selected || selected.has(card.id)))
  if (selected && cards.length !== selected.size) throw Object.assign(new Error('图片目标不存在或重复'), { status: 400 })
  return cards.map(({ kind, card }) => {
    const target = libraryTarget(project, kind, card.ref), image = target ? target.variant.image.content || {} : pictureOf(card)
    const pending = Object.values(episode.pendingImages || {}).some(draft => draft.itemId === card.id) || Boolean(card.ref && Object.values(project.libraryPendingImages || project.pendingImages || {}).some(draft => draft.variantId === card.ref.variantId))
    return { itemId: card.id, name: card.name, kind, ready: Boolean(image.assetId || image.localPath || image.url) && !pending, pending, card }
  })
}
