import { element } from './panel-dom.js'
import { characterFactLine, characterFieldValues } from '../shared/character-facts.js'

function materialControl(label, value, { area = false, readOnly = false } = {}) {
  const wrap = element('label')
  wrap.append(element('span', label, 'image-text-key'))
  const input = element(area ? 'textarea' : 'input')
  if (!area) input.type = 'text'
  input.value = value || ''
  input.placeholder = label
  input.readOnly = readOnly
  input.required = !readOnly
  input.maxLength = 10000
  input.setAttribute('aria-label', label)
  wrap.append(input)
  return { wrap, input }
}

export function textMaterials(project, item, actions, hint, busy) {
  const role = item.type === 'role', prop = item.type === 'prop'
  const saved = role
    ? characterFieldValues(item)
    : prop ? { name: item.name || '', description: item.description || '', evidence: item.evidence || '' } : { name: item.name || '', landmark: item.landmark || '', light: item.light || '', space: item.space || '', look: item.look || '' }
  const specs = role
    ? item.presence === 'voice' ? [['name', '姓名'], ['role', '身份'], ['identity', '身份特征', true], ['voiceDescription', '声音特征', true]] : [
      ['nationality', '国籍'],
      ['name', '姓名'],
      ['role', '身份'],
      ['gender', '性别'],
      ['era', '年代'],
      ['age', '年龄'],
      ['height', '身高'],
      ['build', '体型', true],
      ['features', '面相', true],
      ['voiceDescription', '声音特征', true],
    ]
    : prop ? [['name', '名称'], ['description', '描述', true], ['evidence', '依据', true]] : [
      ['name', '名称', false, true],
      ['landmark', '地标', true],
      ['light', '光位', true],
      ['space', '空间', true],
      ['look', '画面', true],
    ]
  const form = element('form', '', 'image-text-editor')
  form.dataset.modelKey = `image-text:${item.id}`
  const head = element('div', '', 'image-text-head')
  head.append(element('h4', '文字资料'))
  const inputs = {}
  const grid = element('div', '', 'image-text-grid')
  for (const [key, label, area, readOnly] of specs) {
    const control = materialControl(label, saved[key], { area, readOnly })
    if (key === 'voiceDescription' && item.presence !== 'voice' || item.presence === 'voice' && key === 'role') control.input.required = false
    if (area) control.wrap.classList.add('image-text-wide')
    inputs[key] = control.input
    grid.append(control.wrap)
  }
  const prompt = element('p', '', 'meta image-text-prompt')
  prompt.setAttribute('aria-label', '生图描述')
  const refreshPrompt = () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]))
    const text = role ? characterFactLine(values) : String(values.look || '').trim()
    prompt.textContent = text
  }
  refreshPrompt()
  // 场景的生图描述即「画面」原文，详情页不再重复展示。
  prompt.hidden = !role || item.presence === 'voice'
  form.append(head, grid, prompt)
  const saving = project.operationActivity === (role ? 'character-text' : prop ? 'prop-text' : 'scene-text')
  const save = element('button', saving ? '保存中' : '保存', 'primary')
  save.type = 'submit'
  save.disabled = busy
  for (const input of Object.values(inputs)) {
    input.disabled = busy || input.readOnly
    input.oninput = () => {
      input.dataset.dirty = 'true'
      form.dataset.dirty = 'true'
      refreshPrompt()
    }
  }
  form.onsubmit = async event => {
    event.preventDefault()
    if (save.disabled) return
    const fields = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]))
    save.disabled = true
    save.textContent = '保存中'
    hint.hidden = true
    try {
      const result = await actions.perform(project, role ? 'character-text' : prop ? 'prop-text' : 'scene-text', { itemId: item.id, original: { ...saved }, fields })
      if (result?.cancelled) return
      Object.assign(saved, fields)
      for (const [key, input] of Object.entries(inputs)) {
        if (input.value.trim() === fields[key]) delete input.dataset.dirty
      }
      if (!Object.values(inputs).some(input => input.dataset.dirty)) {
        delete form.dataset.dirty
        form.querySelector(':focus')?.blur()
        await actions.refresh?.()
      }
    } catch (error) {
      hint.hidden = false
      hint.textContent = error.message
      hint.classList.add('warn')
    } finally {
      save.disabled = false
      save.textContent = '保存'
    }
  }
  const footer = element('div', '', 'form-save-footer'); footer.append(save); form.append(footer)
  return form
}

