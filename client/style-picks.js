import { element } from './dom.js'

export const styleOptions = [
  '写实电影',
  '国风水墨',
  '赛博朋克',
  '日系动漫',
  '美式卡通',
  '黑白胶片',
  '武侠仙侠',
  '都市甜宠',
  '悬疑暗黑',
  '复古港风',
]

function styleParts(value) {
  return String(value || '').split(/[，,]/).map(item => item.trim()).filter(Boolean)
}

export function bindStylePicker(input) {
  const existing = input.parentElement?.querySelector(':scope > .style-picks')
  if (existing) existing.remove()
  const row = element('div', '', 'style-picks')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', '常用风格')
  const buttons = new Map()

  const sync = () => {
    const selected = new Set(styleParts(input.value))
    for (const [label, button] of buttons) {
      const on = selected.has(label)
      button.classList.toggle('is-on', on)
      button.setAttribute('aria-pressed', String(on))
    }
  }

  const toggle = label => {
    const list = styleParts(input.value)
    const index = list.indexOf(label)
    if (index >= 0) list.splice(index, 1)
    else list.push(label)
    input.value = list.join('，')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    sync()
  }

  for (const label of styleOptions) {
    const button = element('button', label, 'style-pick')
    button.type = 'button'
    button.setAttribute('aria-pressed', 'false')
    button.onclick = () => toggle(label)
    buttons.set(label, button)
    row.append(button)
  }

  input.insertAdjacentElement('afterend', row)
  input.addEventListener('input', sync)
  sync()
  return { sync }
}
