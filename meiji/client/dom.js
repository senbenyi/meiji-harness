export function element(tag, text = '', className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
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
