import { scriptStore } from '../../../data/script-store.js'
import { applyScriptChanges, isAiCreation } from '../../../../shared/script-assembly.js'

async function run({ home, project, operation, rootProjects, trace }) {
  const store = scriptStore(home, rootProjects)
  if (operation.action === 'script-propose') {
    const changes = operation.changes || [{ target: { kind: 'body' }, before: project.script, after: String(operation.text || '') }]
    if (!operation.note?.trim()) throw Object.assign(new Error('请填写修改说明'), { status: 400 })
    applyScriptChanges(project, changes)
    const id = await store.propose(project.id, { source: 'edit', baseRevision: operation.baseRevision ?? project.scriptRevision, note: operation.note, changes })
    trace.result = { pendingProposal: id }; return trace
  }
  if (operation.action === 'premise-edit') {
    if (!isAiCreation(project)) throw Object.assign(new Error('导入剧本的项目不使用 AI 创作方向'), { status: 400 })
    const premise = String(operation.text || '').trim()
    if ([...premise.replace(/\s/g, '')].length > 1000) throw Object.assign(new Error('AI 创作方向最多 1000 字'), { status: 400 })
    await rootProjects.save(project.id, { premise }); return trace
  }
  if (operation.action === 'script-proposal-confirm' || operation.action === 'script-proposal-discard') await store.resolve(project.id, operation.proposalId, operation.action === 'script-proposal-confirm' ? operation.selected || [] : [])
  else if (operation.action === 'script-restore') await store.restore(project.id, operation.revision, operation.note)
  else {
    if (!String(operation.note || '').trim()) throw Object.assign(new Error('请填写修改说明'), { status: 400 })
    const next = operation.changes ? applyScriptChanges(project, operation.changes) : { script: String(operation.text || '').trim() }
    if (next.script.length > 200000) throw Object.assign(new Error('剧本不能超过 200000 字符'), { status: 400 })
    if (!operation.changes && project.scriptKind === 'assembled') throw Object.assign(new Error('分节剧本请按小节编辑'), { status: 400 })
    await store.commit(project.id, next, { baseRevision: operation.baseRevision, source: 'edit', note: operation.note })
  }
  return trace
}
export const operations = Object.fromEntries([['script-propose', '提出剧本修改方案'], ['premise-edit', '编辑 AI 创作方向'], ['script-proposal-confirm', '写入剧本方案'], ['script-proposal-discard', '放弃剧本方案'], ['script-edit', '编辑剧本'], ['script-restore', '恢复剧本版本']].map(([id, label]) => [id, { label, scope: 'project', lock: 'project', stage: 'project', agent: id === 'script-propose', step: () => ({ kind: 'save', target: 'script' }), run }]))
