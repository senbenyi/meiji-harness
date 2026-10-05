import { randomUUID } from 'node:crypto'
import { recordStore } from './task-store.js'
import { applyScriptChanges } from '../../shared/script-assembly.js'

const error = message => Object.assign(new Error(message), { status: 409, code: 'SCRIPT_VERSION_CHANGED' })
export const scriptSnapshot = project => ({ content: project.script || '', sections: structuredClone(project.scriptSections), kind: project.scriptKind })
export async function writeScriptRevision(home, project, next, meta = {}) {
  next = { ...next, scriptKind: next.scriptKind || project.scriptKind, scriptSections: next.scriptSections || project.scriptSections }
  const revision = (project.scriptRevision || 0) + 1, content = next.script || ''
  if (project.mode === 'script' && !content.trim()) throw Object.assign(new Error('剧本模式必须提供剧本'), { status: 400 })
  const old = project.script || ''
  let prefix = 0, suffix = 0
  while (prefix < Math.min(old.length, content.length) && old[prefix] === content[prefix]) prefix++
  while (suffix < Math.min(old.length, content.length) - prefix && old[old.length - suffix - 1] === content[content.length - suffix - 1]) suffix++
  const snapshot = { revision, content, sections: structuredClone(next.scriptSections), kind: next.scriptKind,
    createdAt: new Date().toISOString(), actor: meta.actor || 'human', source: meta.source || 'edit',
    episodeId: meta.episodeId || null, operationId: meta.operationId || null, taskId: meta.taskId || null,
    note: meta.note || '', changes: meta.changes || [], stats: { added: content.length - prefix - suffix, removed: old.length - prefix - suffix }, restoredFrom: meta.restoredFrom || null }
  await recordStore(home, project.id).update('script-revisions', String(revision), snapshot)
  return { ...next, scriptRevision: revision, scriptSource: snapshot.source, scriptUpdatedAt: snapshot.createdAt }
}

export function scriptStore(home, projects) {
  return {
    async versions(projectId) {
      const project = await projects.read(projectId)
      return (await recordStore(home, projectId).list('script-revisions')).filter(item => item.revision <= project.scriptRevision).sort((a, b) => b.revision - a.revision)
    },
    async commit(projectId, next, meta = {}) {
      return projects.save(projectId, async project => {
        if (meta.baseRevision != null && meta.baseRevision !== project.scriptRevision) throw error('剧本版本已变化，请重新生成方案')
        const value = typeof next === 'function' ? next(project) : next
        return writeScriptRevision(home, project, value, meta)
      })
    },
    async restore(projectId, revision, note) {
      if (!String(note || '').trim()) throw Object.assign(new Error('恢复须填写修改说明'), { status: 400 })
      const version = (await this.versions(projectId)).find(item => item.revision === Number(revision))
      if (!version) throw Object.assign(new Error('剧本版本不存在'), { status: 404 })
      return this.commit(projectId, { script: version.content, scriptSections: version.sections, scriptKind: version.kind }, { source: 'restore', note, restoredFrom: version.revision })
    },
    async propose(projectId, proposal) {
      const id = randomUUID(), history = recordStore(home, projectId)
      await projects.save(projectId, async project => {
        if (proposal.baseRevision !== project.scriptRevision) throw error('剧本版本已变化')
        const entry = { ...proposal, id, kind: 'script-proposal', status: 'pending' }
        await history.update('artifacts', id, { id, kind: 'script-proposal', published: false, episodeId: proposal.episodeId || null, taskId: proposal.taskId || null, content: entry, createdAt: new Date().toISOString() })
        return { scriptProposals: [...(project.scriptProposals || []).map(item => item.episodeId && item.episodeId === entry.episodeId && item.source === 'episode-sync' && item.status === 'pending' ? { ...item, status: 'superseded' } : item), { id, source: entry.source, baseRevision: entry.baseRevision, episodeId: entry.episodeId, summaryRevision: entry.summaryRevision, status: 'pending' }] }
      })
      return id
    },
    async resolve(projectId, proposalId, selected = []) {
      const history = recordStore(home, projectId), artifact = await history.read('artifacts', proposalId), proposal = artifact.content
      const saved = await projects.save(projectId, async project => {
        const entry = project.scriptProposals.find(item => item.id === proposalId)
        if (!entry || entry.status !== 'pending') throw error('方案已处理或失效')
        const episode = project.episodes.find(item => item.id === proposal.episodeId), deletion = project.scriptPendingDeletes.find(item => item.episodeId === proposal.episodeId)
        if (selected.length && (project.scriptRevision !== proposal.baseRevision || proposal.source === 'episode-sync' && (episode ? episode.summary.revision !== proposal.summaryRevision : !deletion || JSON.stringify(deletion) !== JSON.stringify(proposal.deleteFact)))) throw error('剧本或摘要依据已变化，请重新回写')
        const indexes = [...new Set(selected)]
        if (indexes.some(index => !Number.isInteger(index) || !proposal.changes[index])) throw Object.assign(new Error('方案选项无效'), { status: 400 })
        let patch = {}
        if (indexes.length) patch = await writeScriptRevision(home, project, applyScriptChanges(project, indexes.map(index => proposal.changes[index])), { ...proposal, source: 'proposal', note: proposal.note })
        if (proposal.source === 'episode-sync' && indexes.length === proposal.changes.length && indexes.length) {
          if (episode) episode.summary.basis = { ...episode.summary.basis, scriptSyncedRevision: proposal.summaryRevision }
          else patch.scriptPendingDeletes = project.scriptPendingDeletes.filter(item => item.episodeId !== proposal.episodeId)
        }
        patch.scriptProposals = project.scriptProposals.map(item => item.id === proposalId ? { ...item, status: indexes.length ? 'applied' : 'discarded' } : item)
        return { ...project, ...patch }
      })
      await history.update('artifacts', proposalId, { ...artifact, published: selected.length > 0, content: { ...proposal, status: selected.length ? 'applied' : 'discarded' } })
      return saved
    },
  }
}
