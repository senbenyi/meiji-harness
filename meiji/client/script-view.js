import { targetBusy } from './run-activity.js'
import { confirmPanel, element } from './panel-dom.js'
import { scriptBlockers } from '../shared/script-assembly.js'

export function renderScriptView(project, actions) {
  const page = element('section', '', 'script-page'), back = element('button', '← 返回概要'), message = element('p', '', 'meta')
  back.onclick = actions.back
  page.append(back, element('h2', '项目剧本'), message)
  let dirty = false, refreshSequence = 0, forceRefresh = false
  page.addEventListener('input', event => { if (event.target.matches('input, textarea')) dirty = true })
  page.addEventListener('change', event => { if (event.target.closest('form') || event.target.matches('input')) dirty = true })
  const run = async (action, fields) => { try { await actions.perform(project, action, fields); await page.refresh(true) } catch (error) { message.textContent = error.message } }
  const body = element('div'); page.append(body)
  page.refresh = async (force = false) => {
    forceRefresh ||= force
    const sequence = ++refreshSequence
    try {
      const result = await actions.load()
      if (sequence !== refreshSequence) return
      if (dirty && !forceRefresh) {
        for (const button of body.querySelectorAll('button')) if (button.textContent !== '对比所选版本') button.disabled = button.dataset.available !== 'true' || Boolean(targetBusy(result.project, 'project') || result.project.scriptRevision !== project.scriptRevision)
        if (result.project.scriptRevision !== project.scriptRevision) message.textContent = '剧本已更新，未保存的输入已保留；请重新打开页面核对新版本后保存。'
        return
      }
      dirty = false; forceRefresh = false; message.textContent = ''; project = result.project
      const busy = targetBusy(project, 'project')
      body.replaceChildren()
      body.append(element('p', `${project.scriptKind === 'imported' ? '导入剧本' : '分节剧本'} · V${project.scriptRevision} · ${project.script.length} 字 · ${project.scriptUpdatedAt || ''}`, 'meta'))
      if (!project.script) body.append(element('p', '等待第一集建立剧本。', 'notice'))
      const editor = element('form', '', 'script-editor'), target = element('select'), text = element('textarea'), note = element('input'), save = element('button', '保存为新版本', 'primary')
      target.setAttribute('aria-label', '编辑小节'); text.setAttribute('aria-label', '剧本正文'); text.maxLength = 200000; text.rows = 18
      note.setAttribute('aria-label', '修改说明'); note.placeholder = '修改说明（必填）'; note.required = true
      const targets = project.scriptKind === 'imported' ? [{ kind: 'body', label: '完整剧本', text: project.script }] : [
        ...(project.scriptSections.sections || []).map(item => ({ kind: 'episode', episodeId: item.episodeId, label: `本集小节 ${project.episodes.length - project.episodes.findIndex(episode => episode.id === item.episodeId)}`, text: item.text })),
        { kind: 'future', label: '后续剧情', text: project.scriptSections.future || '' },
      ]
      for (const [index, item] of targets.entries()) { const option = element('option', item.label); option.value = index; target.append(option) }
      target.onchange = () => { text.value = targets[Number(target.value)]?.text || '' }
      target.onchange()
      const count = element('output', `${text.value.length} / 200000 字`); text.oninput = () => { count.textContent = `${text.value.length} / 200000 字` }
      editor.append(target, text, count, note, save); body.append(editor)
      editor.onsubmit = async event => {
        event.preventDefault(); if (!note.value.trim()) { message.textContent = '请填写修改说明'; return }
        const current = targets[Number(target.value)]
        await run('script-edit', { baseRevision: project.scriptRevision, note: note.value.trim(), ...(current.kind === 'body' ? { text: text.value } : { changes: [{ target: { kind: current.kind, ...(current.episodeId ? { episodeId: current.episodeId } : {}) }, before: current.text, after: text.value }] }) })
      }
      const direction = element('form', '', 'script-direction'), start = element('input'), requirements = element('textarea'), generate = element('button', 'AI 修改后续剧情')
      start.type = 'number'; start.min = '0'; start.max = String(project.episodes.length); start.value = String(project.episodes.length); start.setAttribute('aria-label', '从第几集之后修改')
      requirements.required = true; requirements.setAttribute('aria-label', '修改要求'); requirements.placeholder = '手写方向可在上方后续剧情中保存，AI 修改在这里填写要求。'
      direction.append(start, requirements, generate); body.append(direction)
      direction.onsubmit = async event => { event.preventDefault(); if (requirements.value.trim()) await run('script-revise', { fromEpisode: Number(start.value), requirements: requirements.value.trim() }) }
      const pending = element('section', '', 'script-proposals'); pending.append(element('h3', '待处理回写与方案'))
      for (const blocker of scriptBlockers(project).filter(item => item.kind !== 'proposal')) {
        const row = element('div', '', 'script-sync-row'), retry = element('button', '重新回写')
        row.append(element('span', `${blocker.kind === 'episode-delete-sync' ? '已删除剧集待回写' : '剧集待回写'}：${blocker.episodeId}`), retry)
        retry.onclick = () => run('script-sync', { episodeId: blocker.episodeId })
        pending.append(row)
      }
      for (const proposal of result.proposals) {
        if (proposal.status !== 'pending') continue
        const card = element('article', '', 'script-proposal'), inputs = []
        card.append(element('h4', proposal.note || '修改方案'), element('p', `${proposal.source} · ${proposal.episodeId || '项目'} · 依据 V${proposal.baseRevision}`, 'meta'))
        if (proposal.runId && actions.openRun) { const source = element('button', '查看来源任务'); source.onclick = () => actions.openRun(proposal.runId); card.append(source) }
        for (const [index, change] of proposal.changes.entries()) {
          const label = element('label'), checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = index
          label.append(checkbox, element('span', change.target.kind === 'episode' ? change.target.episodeId : change.target.kind)); inputs.push(checkbox)
          card.append(label, element('pre', `原文：\n${change.before || '（新增）'}\n\n新文：\n${change.after || '（删除）'}`))
        }
        const apply = element('button', '写入选中项', 'primary'), discard = element('button', '放弃方案'), regenerate = element('button', '按意见重新生成'), opinion = element('input')
        opinion.setAttribute('aria-label', '方案修改意见')
        apply.disabled = busy || proposal.baseRevision !== project.scriptRevision || proposal.source === 'episode-sync' && proposal.summaryRevision != null && project.episodes.find(item => item.id === proposal.episodeId)?.summary.revision !== proposal.summaryRevision
        apply.onclick = () => run('script-proposal-confirm', { proposalId: proposal.id, selected: inputs.filter(input => input.checked).map(input => Number(input.value)) })
        discard.onclick = () => run('script-proposal-discard', { proposalId: proposal.id })
        regenerate.onclick = () => run(proposal.source === 'episode-sync' ? 'script-sync' : 'script-revise', { episodeId: proposal.episodeId, requirements: opinion.value || proposal.requirements || proposal.note })
        card.append(apply, discard, opinion, regenerate); pending.append(card)
      }
      body.append(pending)
      const versions = element('section', '', 'script-versions'), left = element('select'), right = element('select'), compare = element('button', '对比所选版本'), diff = element('pre')
      left.setAttribute('aria-label', '对比旧版本'); right.setAttribute('aria-label', '对比新版本')
      for (const version of result.versions) {
        for (const select of [left, right]) { const option = element('option', `V${version.revision}`); option.value = version.revision; select.append(option) }
        const row = element('details'), restore = element('button', '恢复为新版本'), episodeIndex = project.episodes.findIndex(item => item.id === version.episodeId)
        const associated = version.episodeId ? episodeIndex < 0 ? `已删除剧集 ${version.episodeId}` : `第 ${project.episodes.length - episodeIndex} 集` : '项目'
        row.append(element('summary', `V${version.revision} · ${version.createdAt} · ${version.source} · ${version.note} · ${associated} · +${version.stats.added}/-${version.stats.removed} 字`), element('pre', version.content), restore)
        restore.onclick = async () => { if (await confirmPanel(`将 V${version.revision} 恢复为新版本，保留所有历史。确认继续？`)) run('script-restore', { revision: version.revision, note: `恢复 V${version.revision}` }) }
        versions.append(row)
      }
      compare.onclick = () => { const a = result.versions.find(item => item.revision === Number(left.value)), b = result.versions.find(item => item.revision === Number(right.value)); diff.textContent = a && b ? `V${a.revision}：\n${a.content}\n\nV${b.revision}：\n${b.content}` : '请选择两个版本' }
      body.append(element('h3', '版本历史'), left, right, compare, diff, versions)
      for (const button of body.querySelectorAll('button')) if (button !== compare) { button.dataset.available = String(!button.disabled); button.disabled ||= busy }
    } catch (error) { message.textContent = error.message }
  }
  void page.refresh()
  return page
}
