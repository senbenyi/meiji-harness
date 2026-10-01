import { reviewFields } from './workflow-review.js'
import { renderDetailImageActions } from './image-review.js'
import { pictureOf } from '../shared/drama-model.js'
import { characterFactLine, characterFieldValues, characterSheet } from '../shared/character-facts.js'
import { request, assetUrl } from './api.js'
import { showPanelDialog, element, appendJsonCopy } from './dom.js'

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
  return pictureOf(item).localPath || ''
}

function field(card, label, value) {
  if (value) card.append(element('p', `${label}：${value}`, 'meta'))
}

const partKinds = [['衣服', 'clothes'], ['坐骑', 'mounts'], ['道具', 'props'], ['发型', 'hairstyles']]
const partTextKey = { clothes: 'costume', mounts: 'mount', props: 'prop', hairstyles: 'hairstyle' }

function partNoteValue(item, slot) {
  if (slot === 'clothes') return characterFieldValues(item).costume
  return String(item?.[partTextKey[slot]] || '').trim()
}

function partNote(project, item, slot, label, actions, hint, busy) {
  const box = element('div', '', 'part-note')
  const input = element('textarea')
  input.value = partNoteValue(item, slot)
  input.placeholder = `${label}描述`
  input.maxLength = 10000
  input.setAttribute('aria-label', `${label}描述`)
  input.disabled = busy
  const save = element('button', project.activity === 'part-text' ? '保存中' : '保存')
  save.type = 'button'
  save.disabled = busy
  save.onclick = async () => {
    if (save.disabled) return
    save.disabled = true
    save.textContent = '保存中'
    hint.hidden = true
    try { await actions.perform(project, 'part-text', { itemId: item.id, slot, text: input.value.trim() }) }
    catch (error) {
      save.disabled = false
      save.textContent = '保存'
      hint.hidden = false
      hint.textContent = error.message
      hint.classList.add('warn')
    }
  }
  box.append(input, save)
  return { box, input }
}
const aspectChoices = [['9:16', '9:16'], ['3:4', '3:4'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9']]

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
  const showStill = (src, alt) => { full.alt = alt; full.src = src; showPanelDialog(preview) }
  const showError = error => {
    hint.hidden = false
    hint.textContent = error.message
    hint.classList.add('warn')
  }
  const characterStudio = item => {
    const reviewing = Boolean(imageGate && imageGate.itemId === item.id && !imageGate.track)
    const controlBusy = busy || reviewing
    const mainReview = reviewing && !imageGate.slot
    const card = element('article', '', 'character-studio')
    const stage = element('section', '', 'studio-stage')
    const toolbar = element('div', '', 'studio-toolbar')
    toolbar.append(element('h3', `${item.id} · ${item.name}`))
    const aspectWrap = element('label', '', 'studio-aspect')
    aspectWrap.append(element('span', '画幅'))
    const aspect = element('select')
    aspect.setAttribute('aria-label', '画幅')
    for (const [value, label] of aspectChoices) {
      const option = element('option', label)
      option.value = value
      if (value === '9:16') option.selected = true
      aspect.append(option)
    }
    aspect.disabled = controlBusy
    aspectWrap.append(aspect)
    toolbar.append(aspectWrap)
    const pair = element('div', '', 'studio-pair')
    const pane = (title, src, emptyLabel, onEmpty) => {
      const box = element('figure', '', 'studio-pane')
      box.append(element('figcaption', title))
      const frame = element('div', '', 'studio-frame')
      if (src) {
        const open = element('button', '', 'asset-still')
        open.type = 'button'
        open.title = '查看大图'
        open.setAttribute('aria-label', `查看大图：${title}`)
        const still = document.createElement('img')
        still.alt = title
        still.src = src
        open.append(still)
        open.onclick = () => showStill(src, `${item.name} · ${title}`)
        frame.append(open)
      } else {
        const plus = element('button', '+', 'asset-placeholder')
        plus.type = 'button'
        plus.disabled = controlBusy
        plus.setAttribute('aria-label', emptyLabel)
        plus.onclick = () => { if (!controlBusy) onEmpty() }
        frame.append(plus)
      }
      box.append(frame)
      return box
    }
    const generate = async (button, label, useReference) => {
      button.disabled = true
      button.textContent = '生成中'
      try {
        await actions.beginImage(project, 'image', {
          itemId: item.id, itemName: item.name, aspect: aspect.value, useReference, ...reviewFields(card),
        })
      } catch (error) {
        button.disabled = false
        button.textContent = label
        showError(error)
      }
    }
    const resultSrc = mainReview && imageGate.previewUrl ? imageGate.previewUrl : stillSrc(item)
    const result = pane('人物图片', resultSrc, `导入图片：${item.name}`, () => { pickId = item.id; pickSlot = ''; picker.click() })
    if (mainReview) result.append(renderDetailImageActions(project, actions, imageGate))
    const resultActions = element('div', '', 'studio-actions')
    const textGen = element('button', imaging === item.id && !imageGate?.useReference ? '生成中' : '文字生图', 'primary')
    textGen.type = 'button'
    textGen.disabled = controlBusy
    textGen.setAttribute('aria-label', '文字生图')
    textGen.onclick = () => generate(textGen, '文字生图', false)
    resultActions.append(textGen)
    if (stillSrc(item)) {
      const edit = element('button', '更换')
      edit.type = 'button'
      edit.disabled = controlBusy
      edit.setAttribute('aria-label', `更换图片：${item.name}`)
      edit.onclick = () => { pickId = item.id; pickSlot = ''; picker.click() }
      resultActions.append(edit)
      if (stillSrc(item)) {
        const remove = element('button', '删除')
        remove.type = 'button'
        remove.disabled = controlBusy
        remove.setAttribute('aria-label', `删除图片：${item.name}`)
        remove.onclick = () => {
          remove.disabled = true
          actions.perform(project, 'clear-image', { itemId: item.id, itemName: item.name, ...reviewFields(card) }).catch(error => {
            remove.disabled = false
            showError(error)
          })
        }
        resultActions.append(remove)
      }
    }
    result.append(resultActions)
    const referenceSrc = item.reference?.localPath || ''
    const reference = pane('参考图', referenceSrc, `上传参考图：${item.name}`, () => { pickId = item.id; pickSlot = 'reference'; picker.click() })
    const referenceActions = element('div', '', 'studio-actions')
    const refGen = element('button', imaging === item.id && imageGate?.useReference ? '生成中' : '参考图生图', 'primary')
    refGen.type = 'button'
    refGen.disabled = controlBusy || !referenceSrc
    refGen.title = referenceSrc ? '根据参考图和文字资料生成人物图片' : '请先上传参考图'
    refGen.setAttribute('aria-label', '参考图生图')
    refGen.onclick = () => { if (!refGen.disabled) generate(refGen, '参考图生图', true) }
    referenceActions.append(refGen)
    if (referenceSrc) {
      const replace = element('button', '更换')
      replace.type = 'button'
      replace.disabled = controlBusy
      replace.setAttribute('aria-label', `更换参考图：${item.name}`)
      replace.onclick = () => { pickId = item.id; pickSlot = 'reference'; picker.click() }
      const clear = element('button', '移除')
      clear.type = 'button'
      clear.disabled = controlBusy
      clear.setAttribute('aria-label', `移除参考图：${item.name}`)
      clear.onclick = () => {
        clear.disabled = true
        actions.perform(project, 'clear-reference', { itemId: item.id, itemName: item.name }).catch(error => {
          clear.disabled = false
          showError(error)
        })
      }
      referenceActions.append(replace, clear)
    }
    reference.append(referenceActions)
    pair.append(result, reference)
    const library = element('button', '从素材库选择人物图片')
    library.type = 'button'
    library.disabled = controlBusy
    library.onclick = async () => {
      library.disabled = true
      const dialog = element('dialog', '', 'picture-picker')
      const head = element('div', '', 'modal-head')
      const close = element('button', '×', 'cancel')
      close.type = 'button'
      close.setAttribute('aria-label', '关闭素材选择')
      close.onclick = () => dialog.close()
      head.append(element('h2', '选择图片素材'), close)
      const content = element('div', '', 'picture-options')
      dialog.append(head, content)
      card.append(dialog)
      dialog.addEventListener('close', () => { dialog.remove(); library.disabled = controlBusy }, { once: true })
      showPanelDialog(dialog)
      content.textContent = '正在读取素材…'
      try {
        const { assets } = await request('assets?category=characters')
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
              await actions.perform(project, 'use-asset', { itemId: item.id, itemName: item.name, assetId: asset.id, category: 'characters' })
              dialog.close()
            } catch (error) {
              showError(error)
              dialog.close()
            }
          }
          content.append(option)
        }
      } catch (error) { content.textContent = error.message }
    }
    const extras = element('div', '', 'studio-library')
    extras.append(library)
    stage.append(toolbar, pair, extras)
    const materials = textMaterials(project, item, actions, hint, controlBusy)
    const parts = element('section', '', 'studio-parts')
    parts.append(element('h4', '其他图片资料'))
    for (const [label, slot] of partKinds) {
      const block = element('div', '', 'part-block')
      const head = element('div', '', 'part-head')
      head.append(element('span', label))
      const note = partNote(project, item, slot, label, actions, hint, controlBusy)
      const generating = activity === `image:${item.id}:${slot}`
      const partReview = reviewing && imageGate.slot === slot
      const aiPart = element('button', generating ? '生成中' : 'AI生图', 'primary')
      aiPart.type = 'button'
      aiPart.disabled = controlBusy
      aiPart.setAttribute('aria-label', `生成${label}：${item.name}`)
      aiPart.onclick = async () => {
        aiPart.disabled = true
        aiPart.textContent = '生成中'
        try { await actions.beginImage(project, 'part-image', { itemId: item.id, itemName: item.name, slot, description: note.input.value.trim(), ...reviewFields(block) }) }
        catch (error) {
          aiPart.disabled = false
          aiPart.textContent = 'AI生图'
          showError(error)
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
        open.onclick = () => showStill(src, picture.name || label)
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
        open.onclick = () => showStill(imageGate.previewUrl, `待确认${label}`)
        pics.prepend(open)
      }
      const plus = element('button', '+', 'part-add')
      plus.type = 'button'
      plus.disabled = controlBusy
      plus.setAttribute('aria-label', `导入${label}：${item.name}`)
      plus.onclick = () => { if (!controlBusy) { pickId = item.id; pickSlot = slot; picker.click() } }
      pics.append(plus)
      block.append(head, note.box, pics)
      if (partReview) block.append(renderDetailImageActions(project, actions, imageGate))
      parts.append(block)
    }
    card.append(stage, materials, parts)
    appendJsonCopy(card, item)
    return card
  }
  const nodes = [preview, picker]
  for (const item of items) {
    if (editable && item.type === 'role') {
      nodes.push(characterStudio(item))
      continue
    }
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
      open.onclick = () => { full.alt = item.name; full.src = frameSrc; showPanelDialog(preview) }
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
      for (const [label, slot] of partKinds) {
        const block = element('div', '', 'part-block')
        const head = element('div', '', 'part-head')
        head.append(element('span', label))
        const note = partNote(project, item, slot, label, actions, hint, controlBusy)
        const generating = activity === `image:${item.id}:${slot}`
        const partReview = reviewing && imageGate.slot === slot
        const aiPart = element('button', generating ? '生成中' : 'AI生图', 'primary')
        aiPart.type = 'button'
        aiPart.disabled = controlBusy
        aiPart.onclick = async () => {
          aiPart.disabled = true
          aiPart.textContent = '生成中'
          try { await actions.beginImage(project, 'part-image', { itemId: item.id, itemName: item.name, slot, description: note.input.value.trim(), ...reviewFields(block) }) } catch (error) {
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
          open.onclick = () => { full.alt = picture.name || label; full.src = src; showPanelDialog(preview) }
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
          open.onclick = () => { full.alt = `待确认${label}`; full.src = imageGate.previewUrl; showPanelDialog(preview) }
          pics.prepend(open)
        }
        const plus = element('button', '+', 'part-add')
        plus.type = 'button'
        plus.disabled = controlBusy
        plus.setAttribute('aria-label', `导入${label}：${item.name}`)
        plus.onclick = () => { if (!controlBusy) { pickId = item.id; pickSlot = slot; picker.click() } }
        pics.append(plus)
        block.append(head, note.box, pics)
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
    if (stillSrc(item)) {
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
      showPanelDialog(dialog)
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
    if (item.type === 'role' && stillSrc(item)) {
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

