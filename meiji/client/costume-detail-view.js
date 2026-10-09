import { element } from './panel-dom.js'
import { costumeImageControls } from './costume-image-controls.js'

export function renderCostumeDetail(item, costume, pending, { onBack, onSave, onImageChange, stage, busy = false }) {
  const page = element('section', '', 'costume-detail'), header = element('div', '', 'task-history-header')
  const back = element('button', '← 返回人物资料'); back.type = 'button'; back.onclick = onBack
  header.append(back, element('h2', costume.id ? `${costume.name} · 服装资料` : '添加服装')); page.append(header)
  page.append(costumeImageControls(item, costume, pending, { onChange: onImageChange, onRemove: () => submit(true), stage, busy }))
  const form = element('form', '', 'image-text-editor'), inputs = {}
  if (costume.id) form.append(element('p', `ID ${costume.id}`, 'meta'))
  for (const [key, name] of [['name', '服装名称'], ['description', '服装描述']]) {
    const label = element('label'), input = element(key === 'description' ? 'textarea' : 'input')
    input.value = costume[key] || ''; input.maxLength = 10000; input.required = true; input.disabled = busy; input.setAttribute('aria-label', name)
    label.append(element('span', name), input); form.append(label); inputs[key] = input
  }
  const defaultLabel = element('label'), defaultInput = element('input')
  const isDefault = Boolean(costume.id && item.defaultCostumeId === costume.id)
  defaultInput.type = 'checkbox'; defaultInput.checked = isDefault; defaultInput.disabled = busy || isDefault
  defaultInput.setAttribute('aria-label', '设为默认服装')
  defaultLabel.append(defaultInput, element('span', '设为默认服装')); form.append(defaultLabel)
  const buttons = element('div', '', 'costume-detail-actions form-save-footer'), save = element('button', '保存', 'primary'), remove = element('button', '移除服装'), error = element('p', '', 'hint warn')
  save.type = 'submit'; remove.type = 'button'; save.disabled = remove.disabled = busy; error.hidden = true; error.setAttribute('role', 'status')
  async function submit(deleting) {
    if (save.disabled) return { cancelled: true }
    save.disabled = remove.disabled = back.disabled = true
    defaultInput.disabled = true
    for (const input of Object.values(inputs)) input.disabled = true
    error.hidden = true
    try {
      const result = await onSave(deleting ? null : { ...costume, ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()])) }, { makeDefault: !deleting && defaultInput.checked })
      if (!result?.cancelled) await onBack()
      return result
    } catch (failure) { error.textContent = failure.message; error.hidden = false; return { cancelled: true } }
    finally { save.disabled = remove.disabled = back.disabled = busy; defaultInput.disabled = busy || isDefault; for (const input of Object.values(inputs)) input.disabled = busy }
  }
  form.onsubmit = event => { event.preventDefault(); return submit(false) }
  remove.onclick = () => submit(true)
  remove.className = 'delete-content'; if (costume.id) form.append(remove)
  buttons.append(save)
  form.append(error, buttons); page.append(form); return page
}
