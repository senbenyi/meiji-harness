import { element, showPanelDialog } from '../../../../client/ui/panel-dom.js'

function runButton(label, payload, { state, images, busy, repaint }, error) {
  const control = element('button', label); control.type = 'button'
  control.disabled = !!busy || !!state.imageSubmitting || !images.generate
  control.onclick = async () => {
    if (control.disabled || state.imageSubmitting || !images.isCurrent()) return
    const key = JSON.stringify(payload)
    state.imageRequests ||= {}
    const requestId = state.imageRequests[key] ||= control.ownerDocument.defaultView.crypto.randomUUID()
    state.imageSubmitting = true; state.imageError = ''; repaint()
    try {
      const result = await images.generate(payload, requestId)
      if (!images.isCurrent()) return
      delete state.imageRequests[key]; images.setExecution(result); images.refresh?.()
    } catch (failure) { if (images.isCurrent()) { state.imageError = failure.message; error.textContent = failure.message } }
    finally { state.imageSubmitting = false; if (images.isCurrent()) repaint() }
  }
  return control
}
export function renderImageBatch(root, project, options) {
  const box = element('section', '', 'production-section'), error = element('p', options.state.imageError || '', 'error')
  error.setAttribute('role', 'status')
  box.append(element('h3', '定妆照'), runButton('一键生成所有角色定妆照', { instruction: '生成所有角色及其各套服装的定妆照' },
    { ...options, busy: options.busy || !project.character_extraction.characters.length || project.character_extraction.node_state.status !== 'generated' || project.group_setting?.node_state.status !== 'generated' }, error))
  if (options.images.execution || options.state.imageSubmitting) {
    const progress = element('p', options.state.imageSubmitting ? '正在提交定妆照任务…' : '正在生成定妆照，可在任务历史查看进度。'); progress.setAttribute('role', 'status'); box.append(progress)
  }
  if (options.images.openTasks) { const history = element('button', '定妆照任务历史'); history.type = 'button'; history.onclick = options.images.openTasks; box.append(history) }
  box.append(error); root.append(box); return box
}
export function renderCostumeImages(root, character, project, options) {
  const box = element('section', '', 'costume-images'), asset = project.character_extraction.assets.find(row => row.character_id === character.id)
  box.append(element('h5', '生成定妆照'))
  const list = element('div', '', 'costume-image-list'); list.setAttribute('aria-label', `${character.name}的定妆照`); list.tabIndex = 0
  box.append(list)
  for (const costume of character.costumes.length ? character.costumes : [null]) {
    const image = asset?.costume_images.find(row => row.costume_id === (costume?.id ?? null)), row = element('article', '', 'production-card costume-image-card')
    const content = element('div', '', 'costume-image-content')
    content.append(element('p', costume?.name || '人物定妆照（无指定服装）')); row.append(content)
    if (image?.address) {
      const link = element('a', '', 'costume-image-frame'), preview = element('img'); link.href = image.address; link.target = '_blank'; link.rel = 'noopener'
      link.title = '点击放大查看'
      link.onclick = event => {
        event.preventDefault()
        const dialog = element('dialog', '', 'costume-image-preview'), head = element('div', '', 'modal-head')
        const close = element('button', '关闭'), full = element('img')
        close.type = 'button'; close.onclick = () => dialog.close()
        head.append(element('h3', `${character.name} · ${costume?.name || '定妆照'}`), close)
        full.src = image.address; full.alt = `${character.name}的定妆照原图`
        dialog.append(head, full); root.append(dialog)
        dialog.addEventListener('close', () => dialog.remove(), { once: true })
        showPanelDialog(dialog)
      }
      preview.src = image.address; preview.alt = `${character.name} · ${costume?.name || '定妆照'}`; preview.loading = 'lazy'; link.append(preview); content.append(link)
      if (image.node_state.status === 'expired') row.append(element('p', '资料已变化，照片已过期', 'error'))
    }
    else {
      const placeholder = element('div', '暂无定妆照', 'costume-image-frame costume-image-placeholder')
      placeholder.setAttribute('role', 'img'); placeholder.setAttribute('aria-label', `${character.name} · ${costume?.name || '定妆照'}，尚未生成`)
      content.append(placeholder)
    }
    if (image?.node_state.last_execution && ['failed', 'rejected', 'cancelled'].includes(image.node_state.last_execution.status)) row.append(element('p', image.node_state.last_execution.message, 'error'))
    const error = element('p', '', 'error')
    row.append(runButton(image?.address ? '重新生成' : '生成定妆照', { character_id: character.id, costume_id: costume?.id ?? null, instruction: `生成${character.name}${costume ? `穿着${costume.name}` : ''}的定妆照` },
      { ...options, busy: options.busy || project.character_extraction.node_state.status !== 'generated' || project.group_setting?.node_state.status !== 'generated' }, error), error)
    list.append(row)
  }
  root.append(box)
}
