import { targetNode } from '../server/models/data/drama-model.js'

export const nodeStage = key => ({ summary: 'episode', outline: 'outline', characters: 'outline', scenes: 'outline', props: 'outline', shots: 'shots', shot: 'shot-revise', seconds: 'seconds', storyboard: 'storyboard', film: 'video' })[key.split(':')[0]]
const invalid = message => Object.assign(new Error(message), { status: 400 })
export function nodeSkills(project, episodeId, key) {
  const episode = project.episodes.find(item => item.id === episodeId)
  if (!episode || !nodeStage(key) || !targetNode(episode, key)) throw invalid('剧集或技能节点不存在')
  return episode.supplementalSkills?.[key] || []
}
export function nodeSkillsPatch(project, { episodeId, nodeKey, id, content, remove = false, replace = false }) {
  const items = nodeSkills(project, episodeId, nodeKey)
  if (replace) {
    if (typeof content !== 'string' || content.trim().length > 10000) throw invalid('补充 skill 最多 10000 字')
    const text = content.trim()
    const next = text ? [{ id: items[0]?.id || crypto.randomUUID(), content: text }] : []
    return { episodes: project.episodes.map(episode => episode.id === episodeId ? { ...episode, supplementalSkills: { ...episode.supplementalSkills, [nodeKey]: next } } : episode) }
  }
  if (id && !items.some(item => item.id === id)) throw invalid('补充 skill 不存在')
  const text = typeof content === 'string' ? content.trim() : ''
  if (!remove && (!text || text.length > 10000)) throw invalid('补充 skill 需为 1–10000 字')
  if (remove && !id) throw invalid('删除需要 skill ID')
  const next = remove ? items.filter(item => item.id !== id) : id ? items.map(item => item.id === id ? { ...item, content: text } : item) : [...items, { id: crypto.randomUUID(), content: text }]
  if (next.length > 20) throw invalid('每个节点最多 20 条补充 skill')
  return { episodes: project.episodes.map(episode => episode.id === episodeId ? { ...episode, supplementalSkills: { ...episode.supplementalSkills, [nodeKey]: next } } : episode) }
}
