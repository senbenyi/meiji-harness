import { textMaterials } from './material-editor.js'
import { cardLibraryControls } from './project-library-view.js'
import { targetBusy } from './run-activity.js'
import { historyEntry } from './run-history-entry.js'
import { reviewFields } from './workflow-review.js'
import { renderDetailImageActions, syncImageGate } from './image-review.js'
import { pictureOf } from '../shared/drama-model.js'
import { characterSheet } from '../shared/character-facts.js'
import { request, assetUrl } from './panel-api.js'
import { showPanelDialog, element, appendJsonCopy } from './panel-dom.js'

export { characterSheet }

function imageEntries(project, item, actions) {
  const row = element('div', '', 'story-node-actions')
  if (actions.openHistory) row.append(historyEntry(project, actions, `image:${item.id}`))
  if (actions.openSkill) {
    const skill = item.type === 'prop' ? 'part-image' : item.type === 'role' ? 'character-image' : 'scene-image'
    const button = element('button', '查看 skill')
    button.type = 'button'
    button.setAttribute('aria-label', `${item.type === 'prop' ? '道具图片' : item.type === 'role' ? '人物图片' : '场景图片'} skill`)
    button.onclick = () => actions.openSkill(project, skill)
    row.append(button)
  }
  return row
}

function stillSrc(item) {
  return pictureOf(item).localPath || ''
}

// 场景卡始终左图右文等分；图片画幅随项目，文字资料按标签分行展示。
export function sceneOrientation(project) {
  return String(project?.aspectRatio || '').trim() === '768x1344' || project?.aspectRatio === '9:16' ? 'portrait' : 'landscape'
}

const sceneFacts = [['地标', 'landmark'], ['光位', 'light'], ['空间', 'space'], ['画面', 'look']]

export function cardImageGate(project, item, gate) {
  const episodeId = project.episodeId || project.id
  const current = gate?.itemId === item.id && !gate.slot && !gate.track && (!gate.episodeId || gate.episodeId === episodeId) ? gate : null
  const pendingImages = Object.fromEntries(Object.entries(project.pendingImages || {}).filter(([, draft]) => draft.itemId === item.id && !draft.slot && !draft.track))
  const activity = project.operationActivity === `image:${item.id}` || (current && project.operationActivity === 'confirm-image') ? project.operationActivity : null
  const executionLocks = (project.executionLocks || []).filter(step => step.episodeId === episodeId && step.target === `image:${item.id}`)
  return syncImageGate({ episodes: [{ ...project, id: episodeId, pendingImages, operationActivity: activity, executionLocks }] }, current)
}

export function cardImageControls(project, item, actions, gate) {
  if (item.presence === 'voice') return []
  if (gate) {
    const controls = renderDetailImageActions(project, actions, gate, { regenerate: false, blocked: targetBusy(project, `image:${item.id}`) })
    controls.classList.add('card-image-review')
    return [controls]
  }
  const button = element('button', 'AI生图', 'primary card-image-generate')
  button.type = 'button'
  button.setAttribute('aria-label', `AI生图：${item.name}`)
  button.disabled = targetBusy(project, `image:${item.id}`) || !actions.beginImage
  const error = element('p', '', `hint warn card-image-error${item.type === 'role' ? ' character-error' : ''}`)
  error.hidden = true
  error.setAttribute('role', 'status')
  button.onclick = async () => {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '生成中'
    error.hidden = true
    try {
      await actions.beginImage(project, 'image', { itemId: item.id, itemName: item.name, generationMode: 'regenerate', useReference: false })
    } catch (failure) {
      error.textContent = failure.message
      error.hidden = false
      button.disabled = false
      button.textContent = 'AI生图'
    }
  }
  return [button, error]
}

function sceneCard(project, item, onOpen, actions, imageGate) {
  const card = element('article', '', `scene-card is-${sceneOrientation(project)}`)
  const open = element('button', '', 'scene-card-open')
  open.type = 'button'
  open.setAttribute('aria-label', `场景详情：${item.name}`)
  open.onclick = () => onOpen?.(item.id)
  const media = element('span', '', 'scene-card-media')
  const gate = cardImageGate(project, item, imageGate)
  const src = gate?.previewUrl || stillSrc(item)
  if (src) {
    const image = element('img')
    image.src = src
    image.alt = item.name
    image.loading = 'lazy'
    media.append(image)
  } else {
    media.classList.add('is-empty')
    media.append(element('span', '暂无场景图', 'scene-card-empty'))
  }
  const copy = element('span', '', 'scene-card-copy')
  const title = element('span', '', 'scene-card-title')
  title.append(element('span', item.id, 'scene-card-id'), element('strong', item.name || '未命名场景'))
  copy.append(title)
  const facts = element('span', '', 'scene-card-facts')
  for (const [label, key] of sceneFacts) {
    const value = String(item[key] || '').trim()
    if (!value) continue
    const row = element('span', '', 'scene-fact')
    row.title = `${label}：${value}`
    row.append(element('span', label, 'scene-fact-label'), element('span', value, 'scene-fact-value'))
    facts.append(row)
  }
  if (facts.childElementCount) copy.append(facts)
  const imageColumn = element('div', '', 'scene-card-image')
  const imageOpen = element('button', '', 'scene-card-preview')
  imageOpen.type = 'button'
  imageOpen.setAttribute('aria-label', `场景图片详情：${item.name}`)
  imageOpen.onclick = () => onOpen?.(item.id)
  imageOpen.append(media)
  imageColumn.append(imageOpen, ...cardImageControls(project, item, actions, gate))
  open.append(copy)
  card.append(imageColumn, open)
  return card
}

export function stillCards(project, items, actions, hint, { editable = false, onOpen, imageGate = null } = {}) {
  const activity = typeof project.operationActivity === 'string' ? project.operationActivity : ''
  const imaging = activity.startsWith('image:') ? activity.slice(6) : ''
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
  picker.onchange = async () => {
    const file = picker.files?.[0]
    const itemId = pickId
    picker.value = ''
    pickId = ''
    if (!file || !itemId) return
    try { await actions.importStill(project, itemId, file) } catch (error) {
      hint.hidden = false
      hint.textContent = error.message
      hint.classList.add('warn')
    }
  }
  const nodes = [preview, picker]
  for (const item of items) {
    if (!editable) {
      nodes.push(sceneCard(project, item, onOpen, actions, imageGate))
      continue
    }
    const reviewing = Boolean(imageGate && imageGate.itemId === item.id && !imageGate.track)
    const controlBusy = targetBusy(project, `image:${item.id}`) || targetBusy(project, item.type === 'prop' ? 'props' : 'scenes') || reviewing
    const mainReview = reviewing && !imageGate.slot
    const card = element('article', '', item.type === 'prop' ? 'shot-card story-asset prop-asset' : `shot-card story-asset scene-asset is-${sceneOrientation(project)}`)
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
    const heading = element('div', '', 'workflow-generation-row')
    const entries = imageEntries(project, item, actions)
    heading.append(element('h3', `${item.id} · ${item.name}`), entries)
    if (item.type === 'prop') {
      const remove = element('button', '删除道具', 'delete-content')
      remove.type = 'button'
      remove.disabled = controlBusy
      remove.setAttribute('aria-label', `删除道具：${item.name}`)
      remove.onclick = async () => {
        if (remove.disabled) return
        remove.disabled = true
        hint.hidden = true
        try {
          await actions.perform(project, 'prop-delete', { itemId: item.id, itemName: item.name })
        } catch (error) {
          remove.disabled = false
          hint.hidden = false
          hint.textContent = error.message
          hint.classList.add('warn')
        }
      }
      heading.append(remove)
    }
    copy.append(heading, cardLibraryControls(project, item, actions))
    if (mainReview) copy.append(renderDetailImageActions(project, actions, imageGate))
    if (item.type === 'prop') { copy.append(textMaterials(project, item, actions, hint, controlBusy)); copy.append(element('p', `${item.category} · 所属：${item.ownerId || '未指定'}`, 'meta'), element('p', item.description), element('p', `依据：${item.evidence}`, 'meta')) }
    else copy.append(textMaterials(project, item, actions, hint, controlBusy))
    const actionsRow = element('div', '', 'asset-actions')
    const ai = element('button', imaging === item.id ? '生成中' : 'AI生图', 'primary')
    ai.type = 'button'
    ai.disabled = controlBusy || targetBusy(project, `image:${item.id}`)
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
        const category = item.type === 'prop' ? 'props' : 'scenes'
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
    // 场景详情：图片相关按钮集中在图片下方，标题行只留名称。
    const bar = element('div', '', 'scene-image-bar')
    const tools = element('div', '', 'scene-image-tools')
    tools.append(ai, ...actionsRow.children)
    bar.append(tools, entries)
    frame.append(bar)
    card.append(frame, copy)
    appendJsonCopy(copy, item)
    nodes.push(card)
  }
  return nodes
}
