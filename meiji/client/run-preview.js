import { runGoalLabel } from '../shared/run-view.js'
import { element, showPanelDialog, confirmPanel } from './panel-dom.js'
import { targetLabel } from './run-labels.js'
import { libraryLinks, libraryKinds } from '../shared/library-rules.js'
import { operationDeletes } from '../shared/operation-cascade.js'
export function confirmRunPreview(anchor, initial, { refresh } = {}) {
  const steps = initial.steps || initial.run.steps
  // 生成直接以新数据替换旧数据，被替换的下游内容不再逐项确认；只有前置选择和硬阻断需要弹窗。
  if (!initial.prereq?.length && !initial.blockers?.length) return Promise.resolve({ authorizePrereq: [], confirmDelete: true, projectRevision: initial.projectRevision })
  const dialog = element('dialog', '', 'run-preview-dialog'), head = element('h2', `${initial.amend ? '并入当前任务' : '确认'}：${runGoalLabel(initial.run || {goal: initial.goal})}`), body = element('div'), error = element('p', '', 'error')
  const cancel = element('button', '取消'), confirm = element('button', '确认执行', 'primary')
  dialog.append(head, body, error, cancel, confirm)
  ;(anchor.getRootNode().body || anchor.getRootNode()).append(dialog)
  // 缺少的前置默认纳入，用户可取消勾选。
  let preview = initial, version = 0, accepted = false, selected = new Set((initial.prereq || []).map(entry => entry.key))
  const draw = () => {
    body.replaceChildren()
    const counts = new Map()
    for (const step of preview.steps || preview.run.steps) counts.set(step.target, (counts.get(step.target) || 0) + 1)
    const planned = element('details'); planned.append(element('summary', `将执行：${counts.size} 个对象`))
    for (const [target, count] of counts) planned.append(element('p', `${targetLabel(target)} · ${count} 步`))
    body.append(planned)
    if (preview.prereq?.length) {
      body.append(element('h3', '缺少前置'), element('p', '默认一并完成；取消勾选的前置所在分支会暂停，其余部分继续。', 'meta'))
      for (const entry of preview.prereq) {
        const label = element('label'), check = element('input'); check.type = 'checkbox'; check.value = entry.key; check.checked = selected.has(entry.key)
        check.onchange = async () => {
          check.checked ? selected.add(entry.key) : selected.delete(entry.key)
          if (!refresh) return
          const id = ++version; confirm.disabled = true; error.textContent = '更新预览…'
          try { const result = await refresh([...selected]); if (id !== version) return; preview = { ...result, amend: initial.amend }; error.textContent = ''; draw() }
          catch (failure) { if (id === version) error.textContent = failure.message }
        }
        label.append(check, document.createTextNode(entry.message)); body.append(label)
      }
    }
    for (const blocker of preview.blockers || []) body.append(element('p', blocker.message, 'error'))
    confirm.disabled = Boolean(preview.blockers?.length)
  }
  draw()
  if (selected.size && refresh) { const id = ++version; confirm.disabled = true; refresh([...selected]).then(result => { if (id !== version) return; preview = { ...result, amend: initial.amend }; draw() }, failure => { if (id === version) error.textContent = failure.message }) }
  return new Promise(resolve => {
    cancel.onclick = () => dialog.close()
    confirm.onclick = () => { accepted = true; dialog.close() }
    dialog.addEventListener('close', () => { version++; dialog.remove(); resolve(accepted ? { authorizePrereq: [...selected], confirmDelete: true, projectRevision: preview.projectRevision } : null) }, { once: true })
    showPanelDialog(dialog)
  })
}

// 即时编辑保存前的删除与库同步确认；制作任务的删除清单在上面的预览弹窗确认。
export function confirmEditDelete(project, operation, confirm = confirmPanel) {
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
  const projectDeletes = deletes.filter(item => !item.episodeId)
  if (projectDeletes.length) lines.unshift(`项目：${projectDeletes.map(item => item.label).join('、')}`)
  return confirm(`${count ? `将同步到 ${count} 集。\n` : ''}${deletes.length ? '保存后将删除以下内容：\n' : ''}${lines.join('\n')}\n确认后继续。`)
}
