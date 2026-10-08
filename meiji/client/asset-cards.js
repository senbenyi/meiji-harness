import { cardLibraryControls } from './project-library-view.js'
import { targetBusy } from './run-activity.js'
import { historyEntry } from './run-history-entry.js'
import { reviewFields } from './workflow-review.js'
import { renderDetailImageActions, syncImageGate } from './image-review.js'
import { pictureOf } from '../shared/drama-model.js'
import { characterFactLine, characterFieldValues, characterSheet } from '../shared/character-facts.js'
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
      await actions.perform(project, role ? 'character-text' : prop ? 'prop-text' : 'scene-text', { itemId: item.id, original: saved, fields })
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

const aspectChoices = [['9:16', '9:16'], ['3:4', '3:4'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9']]

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
    if (item.presence === 'voice') {
      const card = element('article', '', 'character-studio')
      card.append(element('h3', `${item.id} · ${item.name}（仅声音）`), cardLibraryControls(project, item, actions), textMaterials(project, item, actions, hint, targetBusy(project, 'characters')))
      appendJsonCopy(card, item)
      return card
    }
    const reviewing = Boolean(imageGate && imageGate.itemId === item.id && !imageGate.track)
    const controlBusy = targetBusy(project, `image:${item.id}`) || targetBusy(project, item.type === 'role' ? 'characters' : item.type === 'prop' ? 'props' : 'scenes') || reviewing
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
    const pair = element('div', '', 'studio-pair')
    const tools = element('div', '', 'studio-tools')
    tools.setAttribute('aria-label', '人物图片工具')
    // 主图为镜头实际使用的人物图，参考图只是可选的生成输入：两者在尺寸、底色和标签上区分主次。
    const pane = (title, src, emptyLabel, onEmpty, { kind, badge, note } = {}) => {
      const box = element('figure', '', `studio-pane is-${kind}`)
      const caption = element('figcaption', '', 'studio-caption')
      const name = element('span', '', 'studio-caption-title')
      name.append(element('strong', title), element('span', badge, 'studio-badge'))
      caption.append(name)
      box.append(caption)
      if (note) box.append(element('p', note, 'studio-note'))
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
      if (button.disabled) return
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
    const result = pane('人物图片', resultSrc, `导入图片：${item.name}`, () => { pickId = item.id; pickSlot = ''; picker.click() }, { kind: 'main', badge: '主图' })
    const referenceSrc = item.reference?.localPath || ''
    const aiGenerate = element('button', imaging === item.id ? '生成中' : 'AI生成', 'primary')
    aiGenerate.type = 'button'
    aiGenerate.disabled = controlBusy || targetBusy(project, `image:${item.id}`)
    aiGenerate.setAttribute('aria-label', 'AI生成')
    aiGenerate.onclick = () => generate(aiGenerate, 'AI生成', Boolean(referenceSrc))
    tools.append(aspectWrap, aiGenerate)
    if (mainReview) tools.append(renderDetailImageActions(project, actions, imageGate, { regenerate: false }))
    const resultActions = element('div', '', 'studio-actions')
    const edit = element('button', stillSrc(item) ? '更换图片' : '导入图片')
    edit.type = 'button'
    edit.disabled = controlBusy
    edit.setAttribute('aria-label', `${stillSrc(item) ? '更换' : '导入'}图片：${item.name}`)
    edit.onclick = () => { pickId = item.id; pickSlot = ''; picker.click() }
    resultActions.append(edit)
    if (stillSrc(item)) {
      const remove = element('button', '删除图片')
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
    const reference = pane('参考图', referenceSrc, `上传参考图：${item.name}`, () => { pickId = item.id; pickSlot = 'reference'; picker.click() }, { kind: 'reference', badge: '可选', note: referenceSrc ? 'AI生成时使用此参考图' : '无参考图时使用文生图' })
    const referenceActions = element('div', '', 'studio-actions')
    const replace = element('button', referenceSrc ? '更换参考图' : '上传参考图')
    replace.type = 'button'
    replace.disabled = controlBusy
    replace.setAttribute('aria-label', `${referenceSrc ? '更换' : '上传'}参考图：${item.name}`)
    replace.onclick = () => { pickId = item.id; pickSlot = 'reference'; picker.click() }
    referenceActions.append(replace)
    if (referenceSrc) {
      const clear = element('button', '移除参考图')
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
      referenceActions.append(clear)
    }
    const library = element('button', '从素材库选择')
    library.setAttribute('aria-label', '从素材库选择人物图片')
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
    resultActions.append(library)
    tools.append(resultActions, referenceActions, imageEntries(project, item, actions))
    pair.append(result, reference, tools)
    stage.append(toolbar, pair)
    const materials = textMaterials(project, item, actions, hint, controlBusy)
    card.append(cardLibraryControls(project, item, actions), stage, materials)
    appendJsonCopy(card, item)
    return card
  }
  const nodes = [preview, picker]
  for (const item of items) {
    if (editable && item.type === 'role') {
      nodes.push(characterStudio(item))
      continue
    }
    if (!editable) {
      nodes.push(sceneCard(project, item, onOpen, actions, imageGate))
      continue
    }
    const reviewing = Boolean(imageGate && imageGate.itemId === item.id && !imageGate.track)
    const controlBusy = targetBusy(project, `image:${item.id}`) || targetBusy(project, item.type === 'role' ? 'characters' : item.type === 'prop' ? 'props' : 'scenes') || reviewing
    const mainReview = reviewing && !imageGate.slot
    const card = element('article', '', item.type === 'role' ? 'shot-card story-asset' : item.type === 'prop' ? 'shot-card story-asset prop-asset' : `shot-card story-asset scene-asset is-${sceneOrientation(project)}`)
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
        const category = item.type === 'prop' ? 'props' : item.type === 'role' ? 'characters' : 'scenes'
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
    if (item.type !== 'role') {
      // 场景详情：图片相关按钮集中在图片下方，标题行只留名称。
      const bar = element('div', '', 'scene-image-bar')
      const tools = element('div', '', 'scene-image-tools')
      tools.append(ai, ...actionsRow.children)
      bar.append(tools, entries)
      frame.append(bar)
    } else if (actionsRow.childElementCount) copy.append(actionsRow)
    card.append(frame, copy)
    appendJsonCopy(copy, item)
    nodes.push(card)
  }
  return nodes
}
