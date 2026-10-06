import { element, showPanelDialog } from './panel-dom.js'
export function chooseEditContinuation(anchor) {
  const dialog = element('dialog'), later = element('button', '稍后处理'), review = element('button', '复审后继续', 'primary'), override = element('button', '直接通过并继续')
  dialog.append(element('h2', '编辑已保存'), element('p', '原步骤已作废。选择如何继续当前任务。'), review, override, later)
  ;(anchor.getRootNode().body || anchor.getRootNode()).append(dialog)
  return new Promise(resolve => {
    let action = null
    review.onclick = () => { action = 'review'; dialog.close() }
    override.onclick = () => { action = 'override'; dialog.close() }
    later.onclick = () => dialog.close()
    dialog.addEventListener('close', () => { dialog.remove(); resolve(action) }, { once: true })
    showPanelDialog(dialog); review.focus()
  })
}
