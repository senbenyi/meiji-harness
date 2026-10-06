import { element, showPanelDialog } from './panel-dom.js'
import { targetLabel } from './run-labels.js'
export function confirmRunPreview(anchor, initial, { refresh } = {}) {
  const steps = initial.steps || initial.run.steps
  if (!initial.amend && !initial.prereq?.length && !initial.deletions?.length && !initial.blockers?.length && new Set(steps.map(step => step.target)).size <= 1) return Promise.resolve({ authorizePrereq: [], confirmDelete: true, projectRevision: initial.projectRevision })
  const dialog = element('dialog', '', 'run-preview-dialog'), head = element('h2', initial.amend ? '并入当前任务' : '确认制作任务'), body = element('div'), error = element('p', '', 'error')
  const cancel = element('button', '取消'), confirm = element('button', '确认执行', 'primary')
  dialog.append(head, body, error, cancel, confirm)
  ;(anchor.getRootNode().body || anchor.getRootNode()).append(dialog)
  let preview = initial, version = 0, accepted = false, selected = new Set()
  const draw = () => {
    body.replaceChildren()
    const counts = new Map()
    for (const step of preview.steps || preview.run.steps) counts.set(step.target, (counts.get(step.target) || 0) + 1)
    const planned = element('details'); planned.append(element('summary', `将执行：${counts.size} 个对象`))
    for (const [target, count] of counts) planned.append(element('p', `${targetLabel(target)} · ${count} 步`))
    body.append(planned)
    if (preview.prereq?.length) {
      body.append(element('h3', '缺少前置'), element('p', '未授权的分支会暂停，其余可执行部分继续。', 'meta'))
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
    if (preview.deletions?.length) {
      body.append(element('h3', '将删除'))
      const deletions = element('ul')
      for (const item of preview.deletions) deletions.append(element('li', `${item.label || item.kind}${item.track ? ` · ${item.track}` : ''}`))
      body.append(deletions, element('p', '仅清理下游内容，素材与任务历史保留。', 'meta'))
    }
    for (const blocker of preview.blockers || []) body.append(element('p', blocker.message, 'error'))
    confirm.disabled = Boolean(preview.blockers?.length)
  }
  draw()
  return new Promise(resolve => {
    cancel.onclick = () => dialog.close()
    confirm.onclick = () => { accepted = true; dialog.close() }
    dialog.addEventListener('close', () => { version++; dialog.remove(); resolve(accepted ? { authorizePrereq: [...selected], confirmDelete: true, projectRevision: preview.projectRevision } : null) }, { once: true })
    showPanelDialog(dialog)
  })
}
