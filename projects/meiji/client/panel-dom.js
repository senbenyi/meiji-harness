import { element, showPanelDialog } from "../../drama/src/client/panel-dom.js";
export { element, showPanelDialog };

export function showImagePreview(root, asset) {
  const dialog = element('dialog', '', 'still-preview');
  const image = element('img'), close = element('button', '×', 'cancel');
  image.src = asset.src;
  image.alt = asset.alt;
  dialog.setAttribute('aria-label', asset.alt || '图片预览');
  close.setAttribute('aria-label', '关闭图片预览');
  close.onclick = () => dialog.close();
  dialog.append(image, close);
  root.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  showPanelDialog(dialog);
}
export function showVideoPreview(root, source, label = '视频播放') {
  const dialog = element('dialog', '', 'still-preview video-preview');
  const video = element('video'), close = element('button', '×', 'cancel');
  video.src = source;
  video.controls = true;
  video.autoplay = true;
  video.setAttribute('aria-label', label);
  dialog.setAttribute('aria-label', label);
  close.setAttribute('aria-label', '关闭视频');
  close.onclick = () => dialog.close();
  dialog.append(video, close);
  root.append(dialog);
  dialog.addEventListener('close', () => { video.pause(); dialog.remove(); }, { once: true });
  showPanelDialog(dialog);
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
