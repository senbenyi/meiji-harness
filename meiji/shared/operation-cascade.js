import { libraryKinds, libraryLinks } from './library-rules.js'
import { cascadePreview } from './pipeline-cascade.js'

// 一次操作合并所有受影响剧集；面板与会话共用同一份删除清单。
export function operationDeletes(project, op) {
  if (!project || op.draft) return []
  const episodes = project.episodes || [project]
  const selected = episodes.filter(episode => episode.id === op.episodeId || episode.episodeId === op.episodeId || (!op.episodeId && episodes.length === 1))
  const fields = op.fields || {}
  const cardActions = ['character-text', 'scene-text', 'prop-text', 'import-image', 'use-asset', 'clear-image', 'confirm-image']
  const source = selected[0], itemId = op.itemId || source?.pendingImages?.[op.draftId]?.itemId
  const card = source && Object.keys(libraryKinds).flatMap(key => source.plot[key].items).find(item => item.id === itemId)
  if ((cardActions.includes(op.action) && card?.ref && !op.newVariant) || ['entry-edit', 'entry-image', 'entry-image-clear', 'entry-image-confirm', 'entry-merge'].includes(op.action)) {
    const kind = op.libraryKind || Object.keys(libraryKinds).find(key => source?.plot[key].items.includes(card))
    const links = libraryLinks(project, kind, op.libraryId || card.ref.libraryId, op.action === 'entry-merge' || ['name', 'aliases', ...libraryKinds[kind].identity].some(key => fields[key] !== undefined) ? null : op.variantId || card?.ref.variantId)
    return links.flatMap(link => {
      const episode = episodes.find(item => item.id === link.episodeId)
      return cascadePreview(episode, { type: op.action === 'entry-merge' ? 'merge' : 'library', itemId: link.cardId, name: link.name })
    })
  }
  let changes = []
  if (op.action === 'overview') {
    const type = fields.aspectRatio && fields.aspectRatio !== project.aspectRatio ? 'aspect' : fields.style != null && fields.style !== project.style ? 'style' : null
    if (type) return episodes.flatMap(episode => cascadePreview(episode, { type }))
  }
  if (op.action === 'project-delete') return episodes.flatMap(episode => cascadePreview(episode, { type: 'episode-delete' }))
  for (const episode of selected) {
    let change
    if (op.action === 'summary') change = { type: 'summary' }
    if (['episode-edit', 'source'].includes(op.action) && (fields.summary != null && fields.summary !== episode.summary.content || fields.durationSeconds != null && Number(fields.durationSeconds) !== episode.durationSeconds)) change = { type: 'summary' }
    else if (op.action === 'source' && fields.aspectRatio && fields.aspectRatio !== project.aspectRatio) change = { type: 'aspect' }
    if (op.action === 'story') change = { type: op.only ? 'cards' : 'outline', key: op.only }
    if (op.action === 'outline-text' && op.outline !== episode.plot.outline.content) change = { type: 'outline' }
    if (op.action === 'shot-table') change = { type: op.track ? 'shot' : 'shots', track: op.track }
    if (op.action === 'seconds') change = { type: 'seconds', track: op.track || episode.shots.items[0]?.id }
    if (['storyboard-text', 'shot-assets'].includes(op.action)) change = { type: 'storyboard', track: op.track }
    if (op.action === 'film') change = { type: op.parts === 'video' || op.parts === 'tail' ? 'video' : 'storyboard', track: op.track || episode.shots.items[0]?.id }
    if (['character-text', 'scene-text', 'prop-text'].includes(op.action)) {
      const key = op.action === 'character-text' ? 'characters' : op.action === 'prop-text' ? 'props' : 'scenes'
      const card = episode.plot[key].items.find(item => item.id === op.itemId)
      if (card && Object.entries(fields).some(([key, value]) => String(value).trim() !== String(card[key] || '').trim())) change = { type: 'appearance', itemId: op.itemId, name: card.name }
    }
    if (['import-image', 'use-asset', 'clear-image'].includes(op.action)) change = { type: 'image', itemId: op.itemId }
    if (op.action === 'confirm-image') {
      const draft = episode.pendingImages?.[op.draftId]
      if (draft && !draft.slot) change = { type: 'image', itemId: draft.itemId }
    }
    if (['card-link', 'card-unlink'].includes(op.action)) change = { type: 'library', itemId: op.itemId }
    if (op.action === 'prop-delete') change = { type: 'card-delete', itemId: op.itemId }
    if (op.action === 'episode-delete') change = { type: 'episode-delete' }
    if (op.action === 'film' && !op.track) {
      for (const shot of episode.shots.items) changes.push(...cascadePreview(episode, { ...change, track: shot.id }))
    } else if (change && (!['seconds', 'storyboard', 'video'].includes(change.type) || episode.shots.items.length)) changes.push(...cascadePreview(episode, change))
  }
  return [...new Map(changes.map(item => [JSON.stringify(item), item])).values()]
}
