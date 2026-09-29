import { reviewFields } from './workflow-review.js'
import { renderDetailImageActions } from './image-review.js'
import { pictureOf } from '../shared/drama-model.js'
import { characterFactLine, characterFieldValues, characterSheet } from '../shared/character-facts.js'
import { request, assetUrl } from './api.js'
import { element, appendJsonCopy } from './dom.js'

export { characterSheet }

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

function textMaterials(project, item, actions, hint, busy) {
  const role = item.type === 'role'
  const saved = role
    ? characterFieldValues(item)
    : { name: item.name || '', landmark: item.landmark || '', light: item.light || '', space: item.space || '', look: item.look || '' }
  const specs = role
    ? [
      ['nationality', '国籍'],
      ['name', '姓名'],
      ['role', '身份'],
      ['gender', '性别'],
      ['era', '年代'],
      ['age', '年龄'],
      ['costume', '服装'],
      ['height', '身高'],
      ['build', '体型', true],
      ['features', '面相', true],
    ]
    : [
      ['name', '名称', false, true],
      ['landmark', '地标'],
      ['light', '光位'],
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
  form.append(head, grid, prompt)
  const saving = project.activity === (role ? 'character-text' : 'scene-text')
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
      await actions.perform(project, role ? 'character-text' : 'scene-text', { itemId: item.id, original: saved, fields })
      delete form.dataset.dirty
      for (const input of Object.values(inputs)) delete input.dataset.dirty
    } catch (error) {
      save.disabled = false
      save.textContent = '保存'
      hint.hidden = false
      hint.textContent = error.message
      hint.classList.add('warn')
    }
  }
  head.append(save)
  return form
}

function stillSrc(item) {
  if (pictureOf(item).localPath) return pictureOf(item).localPath
  if (typeof pictureOf(item).imageUrl === 'string' && pictureOf(item).imageUrl.startsWith('/')) return pictureOf(item).imageUrl
  return ''
}

function field(card, label, value) {
  if (value) card.append(element('p', `${label}：${value}`, 'meta'))
}

export function stillCards(project, items, actions, hint, { editable = false, onOpen, imageGate = null } = {}) {
  const activity = typeof project.activity === 'string' ? project.activity : ''
  const imaging = activity.startsWith('image:') ? activity.slice(6) : ''
  const busy = Boolean(activity)
  const preview = document.createElement('dialog')
  preview.className = 'still-preview'
  const closePreview = element('button', '×', 'cancel')
  closePreview.type = 'button'
  closePreview.setAttribute('aria-label', '关闭大图')
  const full = document.createElement('img')
  preview.append(closePreview, full)
  closePreview.onclick = () => preview.close()
  preview.addEventListener('click', event => { if (event.target === preview) preview.close() })
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = 'image/png,image/jpeg,image/webp'
  picker.hidden = true
  let pickId = ''
  let pickSlot = ''
  picker.onchange = async () => {
    const file = picker.files?.[0]
    const itemId = pickId
    const slot = pickSlot
    picker.value = ''
    pickId = ''
    pickSlot = ''
    if (!file || !itemId) return
    try { await actions.importStill(project, itemId, file, slot) } catch (error) {
      hint.hidden = false
      hint.textContent = error.message
      hint.classList.add('warn')
    }
  }
  const nodes = [preview, picker]
  for (const item of items) {
    const reviewing = Boolean(imageGate && imageGate.itemId === item.id && !imageGate.track)
    const controlBusy = busy || reviewing
    const mainReview = reviewing && !imageGate.slot
    const card = element('article', '', 'shot-card story-asset')
    const frame = element('div', '', 'asset-frame')
    const frameSrc = mainReview && imageGate.previewUrl ? imageGate.previewUrl : stillSrc(item)
    if (frameSrc) {
      const open = element('button', '', 'asset-still')
      open.type = 'button'
      open.setAttribute('aria-label', `查看大图：${item.name}`)
      const still = document.createElement('img')
      still.alt = ''
      still.src = frameSrc
      open.append(still)
      open.onclick = () => { full.alt = item.name; full.src = frameSrc; preview.showModal() }
      frame.append(open)
    } else {
      const plus = element('button', '+', 'asset-placeholder')
      plus.type = 'button'
      plus.disabled = controlBusy
      plus.setAttribute('aria-label', `导入图片：${item.name}`)
      plus.onclick = () => { if (!controlBusy) { pickId = item.id; picker.click() } }
      frame.append(plus)
    }
    const copy = element('div', '', 'asset-copy')
    const heading = element('div', '', item.type === 'role' ? 'character-heading' : 'workflow-generation-row')
    if (onOpen && item.type === 'scene') {
      const open = element('button', `${item.id} · ${item.name}`, 'scene-open')
      open.type = 'button'
      open.setAttribute('aria-label', `场景详情：${item.name}`)
      open.onclick = () => onOpen(item.id)
      heading.append(open)
    } else heading.append(element('h3', `${item.id} · ${item.name}`))
    copy.append(heading)
    if (mainReview) copy.append(renderDetailImageActions(project, actions, imageGate))
    if (editable) copy.append(textMaterials(project, item, actions, hint, controlBusy))
    else {
      const rows = item.type === 'role'
        ? characterSheet(item)
        : [['地标', item.landmark], ['光位', item.light], ['空间', item.space], ['画面', item.look]]
      for (const [label, value] of rows) field(copy, label, value)
    }
    if (item.type === 'role') {
      for (const [label, slot] of [['衣服', 'clothes'], ['道具', 'props'], ['发型', 'hairstyles']]) {
        const block = element('div', '', 'part-block')
        const head = element('div', '', 'part-head')
        head.append(element('span', label))
        const generating = activity === `image:${item.id}:${slot}`
        const partReview = reviewing && imageGate.slot === slot
        const aiPart = element('button', generating ? '生成中' : 'AI生图', 'primary')
        aiPart.type = 'button'
        aiPart.disabled = controlBusy
        aiPart.onclick = async () => {
          aiPart.disabled = true
          aiPart.textContent = '生成中'
          try { await actions.beginImage(project, 'part-image', { itemId: item.id, itemName: item.name, slot, ...reviewFields(block) }) } catch (error) {
            hint.hidden = false
            hint.textContent = error.message
            hint.classList.add('warn')
            aiPart.disabled = false
            aiPart.textContent = 'AI生图'
          }
        }
        head.append(aiPart)
        const pics = element('div', '', 'part-pics')
        for (const picture of (Array.isArray(item[slot]) ? item[slot] : [])) {
          const src = stillSrc(picture)
          if (!src) continue
          const open = element('button', '', 'part-still')
          open.type = 'button'
          open.setAttribute('aria-label', `查看大图：${picture.name}`)
          const still = document.createElement('img')
          still.alt = picture.name || ''
          still.src = src
          open.append(still)
          open.onclick = () => { full.alt = picture.name || label; full.src = src; preview.showModal() }
          const pictureCard = element('div', '', 'part-json-card')
          pictureCard.append(open)
          appendJsonCopy(pictureCard, picture)
          pics.append(pictureCard)
        }
        if (partReview && imageGate.previewUrl) {
          const open = element('button', '', 'part-still')
          open.type = 'button'
          open.setAttribute('aria-label', `查看待确认${label}`)
          const still = document.createElement('img')
          still.alt = `待确认${label}`
          still.src = imageGate.previewUrl
          open.append(still)
          open.onclick = () => { full.alt = `待确认${label}`; full.src = imageGate.previewUrl; preview.showModal() }
          pics.prepend(open)
        }
        const plus = element('button', '+', 'part-add')
        plus.type = 'button'
        plus.disabled = controlBusy
        plus.setAttribute('aria-label', `导入${label}：${item.name}`)
        plus.onclick = () => { if (!controlBusy) { pickId = item.id; pickSlot = slot; picker.click() } }
        pics.append(plus)
        block.append(head, pics)
        if (partReview) block.append(renderDetailImageActions(project, actions, imageGate))
        copy.append(block)
      }
    }
    const actionsRow = element('div', '', 'asset-actions')
    const ai = element('button', imaging === item.id ? '生成中' : 'AI生图', 'primary')
    ai.type = 'button'
    ai.disabled = controlBusy
    ai.onclick = async () => {
      ai.disabled = true
      ai.textContent = '生成中'
      try { await actions.beginImage(project, 'image', { itemId: item.id, itemName: item.name, ...reviewFields(copy) }) } catch (error) {
        hint.hidden = false
        hint.textContent = error.message
        hint.classList.add('warn')
        ai.disabled = false
        ai.textContent = 'AI生图'
      }
    }
    heading.append(ai)
    if (stillSrc(item) || pictureOf(item).imageUrl) {
      const edit = element('button', '更换图片')
      edit.type = 'button'
      edit.disabled = controlBusy
      edit.onclick = () => { pickId = item.id; picker.click() }
      actionsRow.append(edit)
    }
    const choose = element('button', '从素材库选择')
    choose.type = 'button'
    choose.disabled = controlBusy
    choose.onclick = async () => {
      choose.disabled = true
      const dialog = element('dialog', '', 'picture-picker')
      const heading = element('div', '', 'modal-head')
      const close = element('button', '×', 'cancel')
      close.type = 'button'
      close.setAttribute('aria-label', '关闭素材选择')
      close.onclick = () => dialog.close()
      heading.append(element('h2', '选择图片素材'), close)
      const content = element('div', '', 'picture-options')
      dialog.append(heading, content)
      card.append(dialog)
      dialog.addEventListener('close', () => { dialog.remove(); choose.disabled = false }, { once: true })
      dialog.showModal()
      content.textContent = '正在读取素材…'
      try {
        const category = item.type === 'role' ? 'characters' : 'scenes'
        const { assets } = await request('assets?category=' + category)
        content.replaceChildren()
        if (!assets.length) content.append(element('p', '暂无素材，可先生成或到片库导入图片。', 'notice'))
        for (const asset of assets) {
          const option = element('button', '', 'picture-option')
          option.type = 'button'
          const image = element('img')
          image.src = assetUrl(asset)
          image.alt = asset.originalName
          option.append(image, element('span', asset.originalName))
          option.onclick = async () => {
            for (const button of content.querySelectorAll('button')) button.disabled = true
            try {
              await actions.perform(project, 'use-asset', { itemId: item.id, itemName: item.name, assetId: asset.id, category })
              dialog.close()
            } catch (error) {
              hint.hidden = false
              hint.textContent = error.message
              dialog.close()
            }
          }
          content.append(option)
        }
      } catch (error) { content.textContent = error.message }
    }
    actionsRow.append(choose)
    if (item.type === 'role' && (stillSrc(item) || /^https?:\/\//.test(String(pictureOf(item).imageUrl || '')))) {
      const remove = element('button', '', 'character-remove')
      remove.title = '删除图片'
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      remove.type = 'button'
      remove.disabled = controlBusy
      remove.setAttribute('aria-label', `删除图片：${item.name}`)
      remove.onclick = () => {
        if (remove.disabled) return
        remove.disabled = true
        actions.perform(project, 'clear-image', { itemId: item.id, itemName: item.name, ...reviewFields(copy) }).catch(error => {
          remove.disabled = false
          hint.hidden = false
          hint.textContent = error.message
          hint.classList.add('warn')
        })
      }
      frame.append(remove)
    }
    if (actionsRow.childElementCount) copy.append(actionsRow)
    card.append(frame, copy)
    appendJsonCopy(copy, item)
    nodes.push(card)
  }
  return nodes
}

