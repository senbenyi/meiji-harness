import { confirmPanel } from './panel-dom.js'
import { libraryLinks, libraryKinds } from '../shared/library-rules.js'
import { operationDeletes } from '../shared/operation-cascade.js'

export function confirmOperationDelete(project, operation, confirm = confirmPanel) {
  const deletes = operationDeletes(project, operation)
  if (operation.confirmDelete === true) return true
  const source = project.episodes?.find(episode => episode.id === operation.episodeId), itemId = operation.itemId || source?.pendingImages?.[operation.draftId]?.itemId
  const card = source && Object.keys(libraryKinds).flatMap(kind => source.plot[kind].items).find(item => item.id === itemId)
  const syncActions = ['character-text', 'scene-text', 'prop-text', 'import-image', 'use-asset', 'clear-image', 'confirm-image', 'entry-edit', 'entry-image', 'entry-image-clear', 'entry-image-confirm', 'entry-merge']
  const kind = operation.libraryKind || Object.keys(libraryKinds).find(kind => source?.plot[kind].items.includes(card))
  const links = kind && syncActions.includes(operation.action) && !operation.newVariant ? libraryLinks(project, kind, operation.libraryId || card?.ref?.libraryId, operation.action === 'entry-merge' || ['name', 'aliases', ...libraryKinds[kind].identity].some(key => operation.fields?.[key] !== undefined) ? null : operation.variantId || card?.ref?.variantId) : []
  const count = new Set(links.map(link => link.episodeId)).size
  if (!deletes.length && !count) return true
  const lines = (project.episodes || [project]).flatMap((episode, index) => {
    const affected = deletes.filter(item => item.episodeId === (episode.episodeId || episode.id))
    if (!affected.length) return []
    const counts = new Map()
    for (const item of affected) counts.set(item.label, (counts.get(item.label) || 0) + 1)
    return [`第 ${index + 1} 集：${[...counts].map(([label, count]) => `${label}${count > 1 ? ` × ${count}` : ''}`).join('、')}`]
  })
  return confirm(`${count ? `将同步到 ${count} 集。\n` : ''}${deletes.length ? '本次操作将删除以下内容：\n' : ''}${lines.join('\n')}\n确认后继续。`)
}
