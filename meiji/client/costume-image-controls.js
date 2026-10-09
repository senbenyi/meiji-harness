import { element, showPanelDialog } from './panel-dom.js'
import { costumePicture } from '../shared/character-costumes.js'
import { request, assetUrl } from './panel-api.js'

export function costumeImageSource(item, costume, pending) {
  const draft = pending?.costumes?.[costume.id], image = costumePicture(costume, item.image?.content)
  return draft ? `/plugins/meiji/image-draft?id=${encodeURIComponent(draft.draftId)}` : image?.assetId ? assetUrl({ category: image.assetCategory || 'characters', id: image.assetId }) : image?.localPath || image?.url || ''
}

export function costumeImageControls(item, costume, pending, { onChange, onRemove, stage, onOpen, busy = false } = {}) {
  const box = element('div', '', 'costume-picture'), preview = element(onOpen ? 'button' : 'div', '', 'costume-picture-preview')
  if (onOpen) { preview.type = 'button'; preview.onclick = onOpen; preview.setAttribute('aria-label', `编辑服装：${costume.name}`) }
  const toolbar = element('div', '', 'costume-picture-actions'), add = element('button', '＋'), remove = element('button', '−'), error = element('p', '', 'hint warn')
  add.type = remove.type = 'button'; add.setAttribute('aria-label', `添加服装图片：${costume.name || '新服装'}`); remove.setAttribute('aria-label', `删除服装：${costume.name || '新服装'}`)
  let src = costumeImageSource(item, costume, pending), saving = false
  const locked = busy || !costume.id || !onChange
  const paint = () => {
    preview.replaceChildren()
    if (src) { const image = element('img'); image.src = src; image.alt = costume.name; preview.append(image) }
    else preview.append(element('span', '暂无图片', 'wardrobe-placeholder'))
    if (onOpen) preview.disabled = saving
    add.disabled = locked || saving; remove.disabled = busy || !costume.id || !onRemove || saving
  }
  if (!costume.id) add.title = '先保存服装资料后添加图片'
  async function change(fields, dialog, file, deleting = false) {
    if (saving || (deleting ? busy || !costume.id || !onRemove : locked)) return
    saving = true; paint(); error.hidden = true
    const buttons = dialog ? [...dialog.querySelectorAll('button')] : []
    buttons.forEach(button => { button.disabled = true })
    try {
      if (file) fields.incomingId = await stage(file)
      const result = await (deleting ? onRemove() : onChange(fields))
      if (result?.cancelled) return
      src = result?.src || ''; dialog?.close()
    } catch (failure) { error.textContent = failure.message; error.hidden = false }
    finally { saving = false; paint(); buttons.forEach(button => { button.disabled = false }) }
  }
  add.onclick = () => {
    const dialog = element('dialog', '', 'costume-image-sheet'), heading = element('h3', '添加服装图片'), content = element('div', '', 'costume-image-options')
    const upload = element('button', '导入'), library = element('button', '从素材库选择'), cancel = element('button', '取消', 'cancel'), input = element('input')
    upload.type = library.type = cancel.type = 'button'; input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true
    upload.onclick = () => input.click()
    input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void change({}, dialog, file) }
    library.onclick = async () => {
      library.disabled = true; error.hidden = true
      try {
        const { assets } = await request('assets?category=characters')
        content.replaceChildren(); heading.textContent = '选择图片素材'
        for (const asset of assets.filter(row => row.mime?.startsWith('image/'))) {
          const button = element('button', '', 'costume-asset-option'), image = element('img'); button.type = 'button'; image.src = assetUrl(asset); image.alt = asset.originalName || asset.name || '图片'
          button.append(image, element('span', image.alt)); button.onclick = () => change({ assetId: asset.id, category: 'characters' }, dialog); content.append(button)
        }
        if (!content.children.length) content.append(element('p', '暂无图片素材'))
      } catch (failure) { error.textContent = failure.message; error.hidden = false; library.disabled = false }
    }
    cancel.onclick = () => dialog.close(); content.append(upload, library); dialog.append(heading, content, error, cancel, input)
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault() })
    dialog.addEventListener('close', () => { box.append(error); dialog.remove() }); box.append(dialog); showPanelDialog(dialog)
  }
  remove.onclick = () => change({}, null, null, true)
  error.hidden = true; error.setAttribute('role', 'status'); toolbar.append(add, remove); box.append(preview, toolbar, error); paint(); return box
}
