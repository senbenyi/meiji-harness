import { reviewFields } from './workflow-review.js'
import { pictureOf } from './drama-model.js'
import { request, assetUrl } from './api.js'
import { element, appendJsonCopy } from './dom.js'

function field(card, label, value) {
  if (value) card.append(element('p', `${label}：${value}`, 'meta'))
}

const characterLabels = ['国籍', '姓名', '身份', '性别', '年代', '年龄', '服装', '身高', '体型', '身型', '面相']

function labeledParts(text, labels) {
  const source = String(text || '')
  const parts = {}
  labels.forEach((label, order) => {
    const mark = `${label}：`
    const start = source.indexOf(mark)
    if (start < 0) return
    const from = start + mark.length
    const next = labels.slice(order + 1).map(item => source.indexOf(`${item}：`, from)).find(index => index >= 0)
    parts[label] = source.slice(from, next === undefined ? source.length : next).trim()
  })
  return parts
}

export function characterSheet(item) {
  const parsed = labeledParts(item.look, characterLabels)
  return [
    ['国籍', item.nationality || parsed.国籍 || '中国'],
    ['姓名', item.name || parsed.姓名],
    ['身份', item.role || parsed.身份],
    ['性别', item.gender || parsed.性别],
    ['年代', item.era || parsed.年代],
    ['年龄', item.age || parsed.年龄],
    ['身高', item.height || parsed.身高],
    ['体型', [item.build || parsed.体型, item.figure || parsed.身型].filter(Boolean).join('，')],
    ['面相', item.features || parsed.面相],
  ]
}

function stillSrc(item) {
  if (pictureOf(item).localPath) return pictureOf(item).localPath
  if (typeof pictureOf(item).imageUrl === 'string' && pictureOf(item).imageUrl.startsWith('/')) return pictureOf(item).imageUrl
  return ''
}

export function stillCards(project, items, actions, hint) {
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
    const card = element('article', '', 'shot-card story-asset')
    const frame = element('div', '', 'asset-frame')
    if (stillSrc(item)) {
      const open = element('button', '', 'asset-still')
      open.type = 'button'
      open.setAttribute('aria-label', `查看大图：${item.name}`)
      const still = document.createElement('img')
      still.alt = ''
      still.src = stillSrc(item)
      open.append(still)
      open.onclick = () => { full.alt = item.name; full.src = stillSrc(item); preview.showModal() }
      frame.append(open)
    } else {
      const plus = element('button', '+', 'asset-placeholder')
      plus.type = 'button'
      plus.disabled = busy
      plus.setAttribute('aria-label', `导入图片：${item.name}`)
      plus.onclick = () => { if (!busy) { pickId = item.id; picker.click() } }
      frame.append(plus)
    }
    const copy = element('div', '', 'asset-copy')
    const heading = element('div', '', item.type === 'role' ? 'character-heading' : 'workflow-generation-row')
    heading.append(element('h3', `${item.id} · ${item.name}`))
    copy.append(heading)
    const rows = item.type === 'role'
      ? characterSheet(item)
      : [['地标', item.landmark], ['光位', item.light], ['空间', item.space], ['画面', item.look]]
    for (const [label, value] of rows) field(copy, label, value)
    if (item.type === 'scene') {
      const edit = element('button', '编辑文字')
      edit.disabled = busy
      heading.append(edit)
      edit.onclick = () => {
        edit.disabled = true
        const editor = element('div', '', 'scene-text-editor')
        const inputs = {}
        for (const [key, label] of [['name', '名称'], ['landmark', '地标'], ['light', '光位'], ['space', '空间'], ['look', '画面描述']]) {
          const row = element('label', label)
          const input = element(key === 'name' ? 'input' : 'textarea')
          input.value = item[key] || ''; input.maxLength = 10000
          if (key === 'name') input.readOnly = true
          input.setAttribute('aria-label', label)
          inputs[key] = input; row.append(input); editor.append(row)
        }
        const save = element('button', '保存并自审', 'primary'), cancel = element('button', '取消')
        cancel.onclick = () => { editor.remove(); edit.disabled = false }
        save.onclick = async () => {
          save.disabled = cancel.disabled = true
          try {
            await actions.perform(project, 'scene-text', { itemId: item.id, original: Object.fromEntries(Object.keys(inputs).map(key => [key, item[key]])), fields: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])) })
            editor.remove(); edit.disabled = false
          } catch (error) { hint.hidden = false; hint.textContent = error.message; save.disabled = cancel.disabled = false }
        }
        editor.append(save, cancel); copy.append(editor)
      }
    }
    if (item.type === 'role') {
      for (const [label, slot] of [['衣服', 'clothes'], ['道具', 'props'], ['发型', 'hairstyles']]) {
        const block = element('div', '', 'part-block')
        const head = element('div', '', 'part-head')
        head.append(element('span', label))
        const generating = activity === `image:${item.id}:${slot}`
        const aiPart = element('button', generating ? '生成中' : 'AI生图', 'primary')
        aiPart.type = 'button'
        aiPart.disabled = busy
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
        const plus = element('button', '+', 'part-add')
        plus.type = 'button'
        plus.disabled = busy
        plus.setAttribute('aria-label', `导入${label}：${item.name}`)
        plus.onclick = () => { if (!busy) { pickId = item.id; pickSlot = slot; picker.click() } }
        pics.append(plus)
        block.append(head, pics)
        copy.append(block)
      }
    }
    const actionsRow = element('div', '', 'asset-actions')
    const ai = element('button', imaging === item.id ? '生成中' : 'AI生图', 'primary')
    ai.type = 'button'
    ai.disabled = busy
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
      edit.disabled = busy
      edit.onclick = () => { pickId = item.id; picker.click() }
      actionsRow.append(edit)
    }
    const choose = element('button', '从素材库选择')
    choose.type = 'button'
    choose.disabled = busy
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
      remove.disabled = busy
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

