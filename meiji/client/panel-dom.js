export function element(tag, text = '', className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

export function confirmPanel(message) {
  const root = document.querySelector('meiji-workbench')?.shadowRoot || document.body
  const dialog = element('dialog'), cancel = element('button', '取消'), confirm = element('button', '确认继续', 'danger')
  dialog.setAttribute('aria-label', '请确认')
  dialog.append(element('h2', '请确认'), element('p', message), cancel, confirm)
  root.append(dialog)
  return new Promise(resolve => {
    let accepted = false
    cancel.onclick = () => dialog.close()
    confirm.onclick = () => { accepted = true; dialog.close() }
    dialog.addEventListener('close', () => { dialog.remove(); resolve(accepted) }, { once: true })
    showPanelDialog(dialog)
    cancel.focus()
  })
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
export function tabs(label, entries, selected, onChange) {
  const row = element('div', '', 'tabs')
  row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', label)
  for (const [key, title] of entries) {
    const button = element('button', title)
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(key === selected))
    button.onclick = () => {
      for (const item of row.children) item.setAttribute('aria-selected', String(item === button))
      onChange(key)
    }
    row.append(button)
  }
  return row
}

const toasts = new WeakMap()

export function showToast(message, root = document) {
  let toast = toasts.get(root)
  if (!toast) {
    const node = element('div', '', 'meiji-toast')
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    toast = { node, timer: null }
    toasts.set(root, toast)
  }
  clearTimeout(toast.timer)
  toast.node.textContent = message
  ;(root.body || root).append(toast.node)
  toast.timer = setTimeout(() => toast.node.remove(), 2000)
}

export function appendJsonCopy(card, value) {
  if (value == null) return
  const row = element('div', '', 'json-copy-row')
  const button = element('button', typeof value === 'string' ? '复制原文' : '复制 JSON', 'json-copy')
  button.type = 'button'
  button.setAttribute('aria-label', typeof value === 'string' ? '复制该卡片原文' : '复制该卡片的 JSON')
  button.onclick = async event => {
    event.stopPropagation()
    button.disabled = true
    try {
      await navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
      showToast('已复制', button.getRootNode())
    } catch {
      showToast('复制失败，请重试', button.getRootNode())
    } finally {
      button.disabled = false
    }
  }
  row.append(button)
  card.append(row)
}

export function appendLogCopy(card) {
  if (card.querySelector(':scope > .meiji-log-copy')) return
  const button = element('button', '复制', 'meiji-log-copy')
  button.type = 'button'
  button.setAttribute('aria-label', '复制日志内容')
  button.onclick = async event => {
    event.stopPropagation()
    const content = card.querySelector('pre') || card.querySelector('[data-disclosure-row] > span:last-child')
    if (!content) return
    button.disabled = true
    try {
      await navigator.clipboard.writeText(content.textContent)
      button.textContent = '已复制'
    } catch {
      button.textContent = '复制失败，重试'
    } finally {
      button.disabled = false
    }
  }
  card.append(button)
}
