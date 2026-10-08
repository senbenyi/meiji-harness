import { cascade, cascadePreview } from './pipeline-cascade.js'
import { characterLibraryTarget } from './library-rules.js'

const missing = message => Object.assign(new Error(message), { status: 404 })
export function deleteEpisodeCharacter(project, itemId, { preview = false } = {}) {
  const item = project.plot.characters.items.find(item => item.id === itemId)
  if (!item) throw missing('人物不存在')
  if (!preview && (item.operation || item.image?.operation && item.image.operation.phase !== 'awaiting-confirmation')) throw Object.assign(new Error('人物正在执行，无法删除'), {status:409})
  const change = { type:'card-delete',itemId,name:item.sourceName || item.name }
  const result = preview ? {patch:{},deletions:cascadePreview(project,change)} : cascade(project,change)
  const next = { ...structuredClone(project), ...result.patch }, group = next.plot.characters, revision = group.revision + 1
  next.plot.characters = { ...group, revision, check: { ...group.check, revision }, items: group.items.filter(card => card.id !== itemId) }
  next.pendingImages = Object.fromEntries(Object.entries(next.pendingImages || {}).filter(([,draft]) => draft.itemId !== itemId))
  return { project: next, deletions: [{episodeId:project.episodeId || project.id,kind:'character',target:`characters:${itemId}`,label:`人物 ${item.name}`}, ...result.deletions] }
}

export function deleteProjectCharacter(project, libraryId, { preview = false } = {}) {
  const entry = project.library.characters.find(entry => entry.id === libraryId)
  if (!entry) throw missing('角色库条目不存在')
  if (!preview && entry.variants.some(variant => variant.image?.operation)) throw Object.assign(new Error('库图片正在执行，无法删除'), {status:409})
  if (project.library.props.some(item => item.ownerLibraryId === libraryId)) throw Object.assign(new Error('角色仍是道具归属，请先修改归属'), {status:409})
  const next = structuredClone(project), names = new Set([entry.name, ...(entry.aliases || [])]), deletions = [{kind:'character-library',target:libraryId,label:`项目角色 ${entry.name}`}]
  next.episodes = next.episodes.map(episode => {
    let value = episode
    const linked = episode.plot.characters.items.filter(card => card.ref?.libraryId === libraryId)
    // 编译副本直接读取库角色时没有本集卡，也必须清理已绑定的媒体结果。
    const directNames = [...new Set(episode.shots.items.flatMap(shot => (shot.seconds.content?.participants || []).filter(person => {
      if (!names.has(person.name)) return false
      return !episode.plot.characters.items.some(card => card.name === person.name || card.sourceName === person.name)
    }).map(person => person.name)))]
    for (const card of linked) { const result = deleteEpisodeCharacter(value,card.id,{preview}); value=result.project; deletions.push(...result.deletions) }
    for (const name of directNames) {
      const change={type:'card-delete',itemId:libraryId,name}
      const result=preview ? {patch:{},deletions:cascadePreview(value,change)} : cascade(value,change)
      value={...value,...result.patch}; deletions.push(...result.deletions)
    }
    return value
  })
  const variants = new Set(entry.variants.map(variant => variant.id))
  next.pendingImages = Object.fromEntries(Object.entries(next.pendingImages || {}).filter(([,draft]) => !variants.has(draft.variantId)))
  next.library.characters = next.library.characters.filter(item => item.id !== libraryId)
  return { project: next, deletions: [...new Map(deletions.map(item => [JSON.stringify(item),item])).values()] }
}

// 剧集入口与预览共用项目级规则；底层本集删除用于全项目级联，避免递归。
export function deleteEpisodeProjectCharacter(project, episodeId, itemId, options = {}) {
  const episode = episodeId ? project.episodes.find(episode => episode.id === episodeId) : project.episodes.length === 1 ? project.episodes[0] : null
  if (!episode) throw missing('请指定有效剧集')
  const item = episode.plot.characters.items.find(card => card.id === itemId)
  if (!item) throw missing('人物不存在')
  const target = characterLibraryTarget(project, item)
  const local = deleteEpisodeCharacter(episode, itemId, options)
  const next = { ...project, episodes: project.episodes.map(value => value.id === episode.id ? local.project : value) }
  if (!target) return {project:next, deletions:local.deletions}
  const global = deleteProjectCharacter(next, target.entry.id, options)
  return { project: global.project, deletions: [...global.deletions, ...local.deletions] }
}
