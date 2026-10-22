export function element(tag, text = '', className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

// 只覆盖插件面板；原生 showModal 会遮挡并禁用整个 Harness 会话。
export function showPanelDialog(dialog) {
  if (dialog.open) return
  const root = dialog.getRootNode()
  const overlay = element('div', '', 'panel-dialog-overlay')
  const level = root.querySelectorAll('.panel-dialog-overlay').length
  overlay.style.zIndex = String(2000 + level * 2)
  dialog.style.zIndex = String(2001 + level * 2)
  dialog.classList.add('panel-dialog')
  dialog.before(overlay)
  const window = dialog.ownerDocument.defaultView
  const escape = event => {
    const overlays = root.querySelectorAll('.panel-dialog-overlay')
    if (event.key !== 'Escape' || overlays.item(overlays.length - 1) !== overlay) return
    event.preventDefault()
    const cancel = new window.Event('cancel', { cancelable: true })
    if (dialog.dispatchEvent(cancel)) dialog.close()
  }
  window.addEventListener('keydown', escape)
  dialog.addEventListener('close', () => {
    overlay.remove()
    window.removeEventListener('keydown', escape)
  }, { once: true })
  dialog.show()
}

export function backHeader(root, title, label, back) {
  const bar = element('div', '', 'episode-bar'), b = element('button', '←')
  b.type = 'button'; b.onclick = back; b.setAttribute('aria-label', label)
  b.className = 'episode-back'
  bar.append(b, element('h2', title)); root.append(bar)
}

