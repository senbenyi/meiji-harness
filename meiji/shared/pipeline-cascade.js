import { outlineText } from './story-outline.js'
import { node, allNodes } from './drama-model.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const rules = { summary: 1, outline: 2, cards: 3, rename: 4, appearance: 5, image: 6, 'card-delete': 7, shots: 8, shot: 9, seconds: 10, storyboard: 11, video: 12, reference: 13, aspect: 14, library: 16, 'episode-delete': 18 }
const labels = { outline: '剧情大纲', characters: '人物卡', scenes: '场景卡', props: '道具卡', shots: '镜头表', seconds: '每秒指令', storyboard: '分镜提示词', video: '视频', tailFrame: '尾帧', assembly: '合成' }

export function shotReferences(shot, id, name) {
  if (!id) return false
  if (name && shot.seconds?.content?.participants?.some(person => person.name === name)) return true
  if (name && shot.seconds?.content?.dialogues?.some(dialogue => dialogue.speakerName === name || dialogue.speakerId === id)) return true
  if (shot.storyboard?.content?.characterSnapshot?.some(person => person.id === id)) return true
  const text = JSON.stringify([shot.content, shot.seconds?.content])
  return Boolean(name && shot.seconds?.content?.version === 2 && JSON.stringify(shot.seconds.content.beats).includes(name)) || text.includes(`|${id}】`) || (shot.storyboard?.content?.referenceSnapshot || []).some(ref => ref.itemId === id || ref.id === id || ref.entityId === id)
}

// 预览和实际删除共用选择逻辑；预览允许展示正在执行的节点，保存必须拒绝。
function compute(project, change, preview) {
  const rule = rules[change.type] || Number(String(change.type).replace(/^R/, ''))
  if (!rule || rule < 1 || rule > 18 || rule === 17) throw new Error('下游删除规则无效')
  const next = structuredClone(project), deletions = []
  const clear = (parent, key, kind = key, track) => {
    const value = parent?.[key]
    if (!value) return
    const busy = allNodesFor(value).find(item => item.operation)
    if (busy && !preview) throw Object.assign(new Error(`无法删除正在执行的${labels[kind] || kind}`), { status: 409, code: 'CONTENT_BUSY', target: busy.id })
    if (value.content == null && !value.items?.length && !value.operation && !value.source && !value.error && value.check?.passed == null) return
    if (value.content != null || value.items?.length || value.operation) deletions.push({ episodeId: project.episodeId || project.id, target: value.id, kind, label: labels[kind] || kind, ...(track ? { track } : {}) })
    parent[key] = { ...node(value.id), revision: (value.revision || 0) + 1, review: structuredClone(value.review || node('').review) }
    if (Array.isArray(value.items)) parent[key].items = []
  }
  const allNodesFor = value => [value, ...(value.items || []).flatMap(item => [item, item.image, ...Object.values(item.parts || {})])].filter(Boolean)
  const items = next.shots?.items || []
  const index = change.track ? items.findIndex(shot => shot.id === change.track) : 0
  if (change.track && index < 0) throw Object.assign(new Error('镜头不存在'), { status: 404 })
  const remove = (shot, kinds) => { for (const kind of kinds) clear(shot, kind, kind, shot.id) }
  const film = shot => remove(shot, ['storyboard', 'video', 'tailFrame'])
  // 必须在清空前确定尾帧链，不能把下一镜的依赖跟着抹掉再判断。
  const chain = start => {
    for (let i = start + 1; i < items.length; i++) {
      if (!items[i].storyboard?.content?.tailReference) break
      film(items[i])
    }
  }
  const assembly = () => clear(next, 'assembly')
  const shots = () => {
    for (const shot of items) for (const value of allNodes( { plot: {}, shots: { items: [shot] } } )) if (value.operation && !preview) throw Object.assign(new Error('镜头下游正在执行，无法删除'), { status: 409, code: 'CONTENT_BUSY', target: value.id })
    clear(next, 'shots'); if (next.shots) next.shots.seconds = node('seconds')
    assembly()
  }
  const cards = key => clear(next.plot, key)
  let removeAllCandidates = false, removeTracks = new Set(), removeIds = new Set()
  if (rule === 1 || rule === 2) {
    if (rule === 1) cards('outline')
    clear(next, 'summary')
    for (const key of ['characters', 'scenes', 'props']) cards(key)
    shots(); removeAllCandidates = true
  } else if (rule === 3) {
    if (['characters', 'scenes'].includes(change.key)) {
      for (const card of next.plot.props.items) removeIds.add(card.id)
      cards('props')
    }
    shots(); removeTracks = new Set(items.map(shot => shot.id))
  } else if ([4, 5, 6, 16].includes(rule)) {
    for (let i = 0; i < items.length; i++) if (shotReferences(items[i], change.itemId, change.name) || (change.name && ((items[i].cast || []).includes(change.name) || items[i].scene === change.name))) { film(items[i]); chain(i); assembly() }
  } else if (rule === 7) {
    if (items.some(shot => shot.seconds?.content?.version !== 2 && shotReferences(shot, change.itemId))) shots()
    else for (let i = 0; i < items.length; i++) if (shotReferences(items[i], change.itemId, change.name)) { film(items[i]); chain(i); assembly() }
    removeIds.add(change.itemId)
  } else if (rule === 8 || rule === 9) {
    for (const shot of items.slice(rule === 9 ? index : 0)) { remove(shot, ['seconds']); film(shot); removeTracks.add(shot.id) }
    clear(next.shots, 'seconds'); assembly()
  } else if (rule === 10) {
    for (const shot of items.slice(index)) { film(shot); removeTracks.add(shot.id) }
    for (const shot of items.slice(index + 1)) remove(shot, ['seconds'])
    clear(next.shots, 'seconds'); assembly()
  } else if (rule === 11 || rule === 12) {
    if (rule === 11) remove(items[index], ['video', 'tailFrame'])
    chain(index); assembly()
  } else if (rule === 14 || rule === 15) {
    for (const shot of items) film(shot)
    assembly(); removeTracks = new Set(items.map(shot => shot.id))
  } else if (rule === 18) {
    for (const value of allNodes(next)) if (value.operation && !preview) throw Object.assign(new Error('剧集正在执行，无法删除'), { status: 409, code: 'CONTENT_BUSY', target: value.id })
    deletions.push({ episodeId: project.episodeId || project.id, kind: 'episode', label: '剧集及历史记录' })
    removeAllCandidates = true
  }
  if (next.pendingImages) next.pendingImages = Object.fromEntries(Object.entries(next.pendingImages).filter(([id, draft]) => {
    const removed = removeAllCandidates || removeIds.has(draft.itemId) || removeTracks.has(draft.track)
    if (removed) deletions.push({ episodeId: project.episodeId || project.id, kind: 'candidate', target: id, label: '候选图' })
    return !removed
  }))
  const patch = Object.fromEntries([...(rule === 1 || rule === 2 ? ['summary'] : []), 'plot', 'shots', 'assembly', 'pendingImages'].filter(key => next[key]).map(key => [key, next[key]]))
  return { patch, deletions }
}

export const cascade = (project, change) => compute(project, change, false)
export const cascadePreview = (project, change) => compute(project, change, true).deletions

// 保存兜底：任何入口改变上游，都在同次原子保存中处理其依赖。
export function cascadeChanges(before, after) {
  const next = structuredClone(after)
  for (const episode of before.episodes || []) if (!(next.episodes || []).some(item => item.id === episode.id)) {
    cascade(episode, { type: 'episode-delete' })
    const ordered = [...before.episodes].reverse(), index = ordered.findIndex(item => item.id === episode.id)
    next.scriptPendingDeletes = [...(next.scriptPendingDeletes || []).filter(item => item.episodeId !== episode.id), { episodeId: episode.id, summaryBefore: outlineText(episode.plot.outline.content), prevEpisodeId: ordered[index - 1]?.id || null, nextEpisodeId: ordered[index + 1]?.id || null }]
  }
  for (const episode of next.episodes || []) {
    const old = structuredClone(before.episodes.find(item => item.id === episode.id))
    if (!old || old.plot.outline.revision !== episode.plot.outline.revision || !same(old.plot.outline.content, episode.plot.outline.content)) {
      const ordered = [...next.episodes].reverse(), previous = ordered[ordered.findIndex(item => item.id === episode.id) - 1]
      episode.plot.outline.basis = { ...episode.plot.outline.basis, scriptRevision: before.scriptRevision || 0, prevOutlineRevision: previous?.plot.outline.revision || 0 }
    }
    if (!old) continue
    const apply = change => {
      // 原节点可能已经被调用方的补丁替换，执行中保护必须核对保存前快照。
      cascade(old, change)
      Object.assign(episode, cascade(episode, change).patch)
    }
    // 改名更新现有正文标记，不视为镜头剧情重写。
    for (const key of ['characters', 'scenes', 'props']) for (const card of (old.plot[key]?.items || [])) {
      const renamed = (episode.plot[key]?.items || []).find(item => item.id === card.id)
      if (!renamed || renamed.name === card.name) continue
      const rewrite = value => typeof value === 'string' ? value.split(card.name).join(renamed.name) : Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, data]) => [key, rewrite(data)])) : value
      for (const entry of [old, episode]) for (const shot of entry.shots.items) {
        // 库别名绑定只改变成片身份，原镜头与新版指令继续使用 sourceName。
        if (shot.seconds?.content?.version === 2 && renamed.sourceName === card.name) continue
        shot.content = rewrite(shot.content); shot.cast = rewrite(shot.cast); shot.scene = rewrite(shot.scene)
        shot.seconds.content = rewrite(shot.seconds.content)
      }
    }
    let change
    if (old.durationSeconds !== episode.durationSeconds) change = { type: 'summary' }
    else if (!same(old.plot.outline.content, episode.plot.outline.content)) change = { type: 'outline' }
    if (change) { apply(change); continue }
    const originalShots = old.shots.items
    if (!same(originalShots.map(shot => [shot.id, shot.duration, shot.content]), episode.shots.items.map(shot => [shot.id, shot.duration, shot.content]))) {
      const whole = originalShots.length !== episode.shots.items.length || originalShots.some((shot, i) => episode.shots.items[i]?.id !== shot.id)
      const track = originalShots.find((shot, i) => !same([shot.duration, shot.content], [episode.shots.items[i]?.duration, episode.shots.items[i]?.content]))?.id
      apply({ type: whole ? 'shots' : 'shot', track: whole ? undefined : track })
    }
    for (const key of ['characters', 'scenes', 'props']) {
      for (const card of (old.plot[key]?.items || [])) {
        const current = (episode.plot[key]?.items || []).find(item => item.id === card.id)
        if (!current) change = { type: 'card-delete', itemId: card.id, name: card.sourceName || card.name }
        else {
          const preparingCharacters = key === 'characters' && old.plot.characters.secondsSource !== episode.plot.characters.secondsSource
          const fields = value => Object.fromEntries(Object.entries({ ...value, ...(key === 'characters' ? { presence: value.presence || 'visible' } : {}) }).filter(([key]) => !(preparingCharacters && !card.voiceDescription && key === 'voiceDescription') && !['status', 'check', 'error', 'revision', 'operation', 'review', 'draft', 'source', 'image', 'costumes'].includes(key)))
          change = !same(fields(card), fields(current)) ? { type: 'appearance', itemId: card.id, name: current?.name || card.name } : !same(card.image?.content, current.image?.content) ? { type: 'image', itemId: card.id, name: current?.name || card.name } : null
        }
        if (change) apply(change)
      }
    }
    for (const id of episode.shots.items.map(shot => shot.id)) {
      const shot = episode.shots.items.find(item => item.id === id)
      const previous = originalShots.find(item => item.id === shot.id)
      if (!previous) continue
      const type = !same(previous.seconds.content, shot.seconds.content) ? 'seconds' : !same(previous.storyboard.content, shot.storyboard.content) ? 'storyboard' : !same(previous.video.content, shot.video.content) ? 'video' : null
      if (type) apply({ type, track: shot.id })
    }
    if (before.aspectRatio !== next.aspectRatio) apply({ type: 'aspect' })
  }
  return next
}
