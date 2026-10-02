// 查看步骤实际提交的提示词，按点击加载，不用当前资料重新拼装。
import { showPanelDialog, element, appendJsonCopy } from './panel-dom.js'

export function openStepPrompts(anchor, { title, load }) {
  const dialog = element('dialog', '', 'task-prompt-dialog')
  dialog.setAttribute('aria-label', title)
  const head = element('div', '', 'modal-head')
  const close = element('button', '关闭')
  close.type = 'button'
  close.onclick = () => dialog.close()
  head.append(element('h2', title), close)
  const status = element('p', '', 'meta')
  status.setAttribute('role', 'status')
  const retry = element('button', '重新加载')
  retry.type = 'button'
  retry.hidden = true
  const content = element('div', '', 'task-prompt-content')
  dialog.append(head, status, retry, content)
  const root = anchor.getRootNode()
  ;(root.body || root).append(dialog)
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor.isConnected) anchor.focus() })
  const refresh = async () => {
    status.textContent = '加载提示词…'
    retry.hidden = true
    content.replaceChildren()
    try {
      const result = await load()
      status.textContent = result.message || (result.prompts.length ? '' : '此步骤没有保存提示词。')
      for (const [index, entry] of result.prompts.entries()) {
        const card = element('section', '', 'task-prompt-request')
        card.append(element('h3', `请求 ${index + 1}`))
        if (entry.messages) {
          for (const message of entry.messages) {
            card.append(element('h4', message.role), element('pre', typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)))
          }
          appendJsonCopy(card, entry.messages)
        } else {
          card.append(element('pre', typeof entry.prompt === 'string' ? entry.prompt : JSON.stringify(entry.prompt, null, 2)))
          appendJsonCopy(card, entry.prompt)
        }
        content.append(card)
      }
    } catch (error) {
      status.textContent = `加载失败：${error.message}`
      retry.hidden = false
    }
  }
  retry.onclick = refresh
  showPanelDialog(dialog)
  void refresh()
  return dialog
}
