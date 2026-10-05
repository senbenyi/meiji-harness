const failure = message => Object.assign(new Error(message), { status: 400, code: 'SCRIPT_CHANGE_INVALID' })
const keyOf = target => target?.kind === 'episode' ? `episode:${target.episodeId}` : target?.kind
// 自动回写的分节剧本是剧情记录，不改变无原始剧本的创作模式。
export const isAiCreation = project => project.scriptKind !== 'imported'
export const creativeDirection = project => isAiCreation(project) ? project.premise || '' : ''
export const scriptSectionsText = sections => [...(sections?.sections || []).map(item => item.text), sections?.future || ''].filter(Boolean).join('\n\n')
export function scriptTargets(project) {
  if (project.scriptKind === 'imported') return [{ kind: 'body' }]
  return [...new Set([...(project.episodes || []).map(item => item.id), ...(project.scriptSections?.sections || []).map(item => item.episodeId), ...(project.scriptPendingDeletes || []).map(item => item.episodeId)])].map(episodeId => ({ kind: 'episode', episodeId })).concat({ kind: 'future' })
}

// 在各目标自己的正文中定位，验证完所有项后一次性应用。
export function applyScriptChanges(project, changes, { allowedTargets = scriptTargets(project) } = {}) {
  if (!Array.isArray(changes)) throw failure('剧本修改须为列表')
  const allowed = new Set(allowedTargets.map(keyOf)), grouped = new Map()
  const sections = structuredClone(project.scriptSections || { sections: [], future: '' })
  const imported = project.scriptKind === 'imported'
  for (const change of changes) {
    const key = keyOf(change?.target)
    if (!allowed.has(key) || !['body', 'future', 'episode'].includes(change?.target?.kind) || (imported ? key !== 'body' : key === 'body')) throw failure('剧本修改目标不在本次范围')
    if (typeof change.before !== 'string' || typeof change.after !== 'string') throw failure('修改原文和新文须为字符串')
    const text = imported ? project.script || '' : key === 'future' ? sections.future || '' : sections.sections.find(item => item.episodeId === change.target.episodeId)?.text || ''
    let offset = text.length
    if (change.before) {
      offset = text.indexOf(change.before)
      if (offset < 0 || text.indexOf(change.before, offset + 1) >= 0) throw failure('修改原文须在目标正文中逐字唯一匹配')
    } else if (!imported && text) throw failure('空原文不能覆盖已有小节或后续方向')
    const entries = grouped.get(key) || []
    if (entries.some(item => Math.max(item.offset, offset) < Math.min(item.offset + item.before.length, offset + change.before.length) || !item.before && !change.before)) throw failure('同一目标的修改范围重叠')
    entries.push({ ...change, offset, original: text }); grouped.set(key, entries)
  }
  let content = project.script || ''
  for (const [key, entries] of grouped) {
    let text = entries[0].original
    for (const entry of entries.sort((a, b) => b.offset - a.offset)) text = text.slice(0, entry.offset) + entry.after + text.slice(entry.offset + entry.before.length)
    if (imported) content = text
    else if (key === 'future') sections.future = text
    else {
      const episodeId = entries[0].target.episodeId, current = sections.sections.find(item => item.episodeId === episodeId)
      if (!text) sections.sections = sections.sections.filter(item => item.episodeId !== episodeId)
      else if (current) current.text = text
      else sections.sections.push({ episodeId, text })
    }
  }
  if (!imported) content = scriptSectionsText(sections)
  if (content.length > 200000) throw failure('剧本不能超过 200000 字符')
  return { script: content, scriptSections: sections, scriptKind: imported ? 'imported' : 'assembled' }
}

export function scriptAppendOnly(before, after, episodeId) {
  if (before.scriptKind === 'imported') return after.script.startsWith(before.script || '') && after.script.length > (before.script || '').length
  const old = before.scriptSections || { sections: [], future: '' }, next = after.scriptSections
  return old.future === next.future && !old.sections.some(item => item.episodeId === episodeId)
    && next.sections.length === old.sections.length + 1
    && next.sections.some(item => item.episodeId === episodeId && item.text)
    && old.sections.every(item => next.sections.some(current => current.episodeId === item.episodeId && current.text === item.text))
}

export function scriptBlockers(project) {
  return [
    ...(project.scriptProposals || []).filter(item => item.status === 'pending').map(item => ({ kind: 'proposal', id: item.id, episodeId: item.episodeId })),
    ...(project.episodes || []).filter(episode => episode.summary?.content && episode.summary?.basis?.scriptSyncedRevision !== episode.summary.revision).map(episode => ({ kind: 'episode-sync', episodeId: episode.id })),
    ...(project.scriptPendingDeletes || []).map(item => ({ kind: 'episode-delete-sync', episodeId: item.episodeId })),
  ]
}
export const scriptFreshness = project => ({ revision: project.scriptRevision || 0, summaryNeedsUpdate: Boolean(project.script) && project.summary.basis?.scriptRevision !== project.scriptRevision })
export function episodeHints(project, episode) {
  const ordered = [...project.episodes].reverse(), previous = ordered[ordered.findIndex(item => item.id === episode.id) - 1]
  return { scriptUpdated: (episode.summary?.basis?.scriptRevision || 0) < (project.scriptRevision || 0), previousModified: Boolean(previous && episode.summary?.basis?.prevSummaryRevision !== previous.summary?.revision), pendingSync: episode.summary?.basis?.scriptSyncedRevision !== episode.summary?.revision }
}
