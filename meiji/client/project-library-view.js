import { textMaterials } from './material-editor.js'
import { renderCostumeDetail } from './costume-detail-view.js'
import { costumeImageSource } from './costume-image-controls.js'
import { characterWardrobe } from './character-wardrobe.js'
import { applyLibraryCard } from '../shared/library-rules.js'
import { cardModel } from '../shared/drama-model.js'
import { costumesEditor } from './character-costumes-editor.js'
import { targetBusy } from './run-activity.js'
import { libraryKinds, libraryLinks } from '../shared/library-rules.js'
import { confirmPanel, element, showPanelDialog } from './panel-dom.js'
import { request, assetUrl } from './panel-api.js'

const labels = { name: '名称', aliases: '别名（逗号分隔）', nationality: '国籍', gender: '性别', role: '身份', era: '年代', age: '年龄', costume: '着装', height: '身高', build: '体型', features: '面相', appearance: '外形', prop: '随身物件', identity: '身份特征', voiceDescription: '声音特征', look: '画面描述', landmark: '地标', light: '光位', space: '空间', description: '描述', evidence: '依据', category: '类别', ownerLibraryId: '归属库 ID' }
function control(form, key, value = '') {
  const wrap = element('label'), input = element(['look', 'description', 'evidence', 'features', 'voiceDescription'].includes(key) ? 'textarea' : 'input')
  wrap.append(element('span', labels[key] || key), input); input.value = value; input.setAttribute('aria-label', labels[key] || key); input.maxLength = 10000; form.append(wrap); return input
}
export function libraryEditor(project, kind, actions, { entry, variant, newVariant = false, importOnly = false, done } = {}) {
  const spec = libraryKinds[kind], dialog = element('dialog'), head = element('div', '', 'modal-head'), close = element('button', '关闭')
  close.onclick = () => dialog.close(); head.append(element('h3', `${entry ? newVariant ? '新增' + spec.variant : '编辑' : '新建'}${spec.label}`), close)
  const form = element('form', '', 'image-text-editor'), inputs = {}
  if (!importOnly) {
    if (!newVariant) for (const key of ['name', 'aliases', ...spec.identity.filter(key => key !== 'required')]) inputs[key] = control(form, key, key === 'aliases' ? (entry?.aliases || []).join('，') : entry?.[key] || '')
    if (kind !== 'characters') inputs.variantLabel = control(form, 'variantLabel', newVariant ? '' : variant?.label || '默认')
    for (const key of spec.fields) inputs[key] = control(form, key, variant?.fields[key] || '')
  }
  const costumes = kind === 'characters' && !importOnly ? costumesEditor(variant?.fields.costumes) : null
  if (costumes) form.append(costumes.element)
  let required
  if (kind === 'characters' && !newVariant && !importOnly) {
    const wrap = element('label'); required = element('input'); required.type = 'checkbox'; required.checked = entry?.required === true; required.setAttribute('aria-label', '必须出场'); wrap.append(required, element('span', '必须出场')); form.append(wrap)
  }
  const photo = element('input'); photo.type = 'file'; photo.accept = 'image/png,image/jpeg,image/webp'; photo.setAttribute('aria-label', '指定照片')
  const assets = element('select'); assets.setAttribute('aria-label', '从素材库选照片'); assets.append(element('option', '不选择照片'))
  void request(`assets?category=${kind}`).then(({ assets: rows }) => { for (const row of rows) { const option = element('option', row.originalName || row.name || row.id); option.value = row.id; assets.append(option) } }).catch(() => {})
  const voiceOnly = kind === 'characters' && variant?.fields.voiceDescription && !variant.fields.look
  if (!voiceOnly) form.append(element('p', importOnly ? '选择素材库中的角色/场景图片，保存后直接使用。' : '可上传照片或从素材库选图，保存后直接使用。', 'meta'), photo, assets)
  const error = element('p', '', 'error'), save = element('button', '保存', 'primary'); save.type = 'submit'; save.disabled = targetBusy(project, 'project')
  form.append(error, save); dialog.append(head, form)
  form.onsubmit = async event => {
    event.preventDefault(); if (save.disabled) return
    save.disabled = true; error.textContent = ''
    const fields = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]))
    if (fields.aliases != null) fields.aliases = fields.aliases.split(/[,，]/).map(value => value.trim()).filter(Boolean)
    if (costumes) fields.costumes = costumes.value()
    if (required) fields.required = required.checked
    try {
      const incomingId = photo.files?.[0] ? await actions.stage(photo.files[0]) : undefined
      const result = await actions.perform(project, newVariant ? 'entry-variant-add' : entry ? 'entry-edit' : 'entry-create', { libraryKind: kind, libraryId: entry?.id, variantId: variant?.id, fields, incomingId, ...(assets.value ? { assetId: assets.value, category: kind } : {}) })
      if (result?.cancelled) { save.disabled = false; return }
      dialog.close(); await done?.()
    } catch (failure) { error.textContent = failure.message; save.disabled = false }
  }
  dialog.addEventListener('close', () => dialog.remove()); return dialog
}
export function renderProjectLibrary(initial, kind, actions, { entryId = null } = {}) {
  const spec = libraryKinds[kind], direct = entryId != null, page = element('section', '', 'task-history-page')
  let project = initial, selected = entryId, costumePage = null
  const header = element('div', '', 'task-history-header'), back = element('button', '← 返回'), title = element('h2', direct ? `${spec.label}详情` : `${spec.label}库`), create = element('button', `＋ 新建${spec.label}`)
  back.onclick = actions.back; create.onclick = () => openEditor(); create.hidden = direct; header.append(back, title, create)
  const body = element('div'); page.append(header, body)
  async function run(action, fields) { try { const result = await actions.perform(project, action, { libraryKind: kind, ...fields }); if (!result?.cancelled) await page.refresh() } catch (error) { actions.fail?.(error) } }
  function openEditor(options = {}) { const dialog = libraryEditor(project, kind, actions, { ...options, done: page.refresh }); page.append(dialog); showPanelDialog(dialog) }
  function paint() {
    create.disabled = targetBusy(project, 'project'); body.replaceChildren()
    header.querySelector('.character-delete-top')?.remove()
    const entries = project.library?.[kind] || [], list = element('div', '', 'characters-strip')
    if (!direct) {
      for (const entry of entries) { const button = element('button', entry.name, 'character-item'); button.onclick = () => { selected = entry.id; paint() }; list.append(button) }
      body.append(list)
    }
    const entry = entries.find(item => item.id === selected)
    if (!entry) { body.append(element('p', entries.length ? '选择条目查看详情与变体。' : '暂无条目，可手动新建或从审核通过的剧情卡片建立。')); return }
    if (kind === 'characters') { title.textContent = `${entry.name} · 人物资料`; page.classList.add('character-detail') }
    const detail = element('article', '', 'overview-card')
    if (kind !== 'characters') detail.append(element('h3', `${entry.id} · ${entry.name}`))
    if (entry.aliases.length) detail.append(element('p', `别名：${entry.aliases.join('、')}`, 'meta'))
    if (kind === 'characters' && entry.required) detail.append(element('p', '必须出场', 'meta'))
    const variants = kind === 'characters' ? entry.variants.filter(item => item.id === entry.defaultVariantId).slice(0, 1) : entry.variants
    if (kind !== 'characters') { const add = element('button', `新增${spec.variant}`); add.disabled = targetBusy(project, 'project'); add.onclick = () => openEditor({ entry, variant: entry.variants.find(item => item.id === entry.defaultVariantId), newVariant: true }); detail.append(add) }
    for (const variant of variants) {
      const block = element('section'), image = variant.image.content
      const generate = element('button', kind === 'characters' ? '逐套生成人物图片' : '重新生成'); generate.setAttribute('aria-label', `重新生成${spec.label}图片：${entry.name}`); generate.disabled = targetBusy(project, `image:${variant.id}`); generate.onclick = () => run('library-image', { libraryId: entry.id, variantId: variant.id, generationMode: 'regenerate' })
      const portrait = kind === 'characters' ? element('section', '', 'character-primary-picture') : block
      if (kind !== 'characters') block.append(element('h4', `${variant.label}${entry.defaultVariantId === variant.id ? '（默认）' : ''}`))
      if (kind === 'characters') block.append(portrait)
      if (image?.localPath || image?.assetId) { const img = element('img'); img.src = image.assetId ? assetUrl({ category: image.assetCategory || kind, id: image.assetId }) : image.localPath; img.alt = variant.label; img.style.maxWidth = '240px'; portrait.append(img, element('p', image.source === 'photo' ? '指定照片' : '生成图片', 'meta')) }
      if (kind === 'characters') {
        const card = applyLibraryCard(project, kind, cardModel({ id: variant.id, type: 'role' }), { entry, variant })
        const hint = element('p', '', 'hint warn'); hint.hidden = true
        const pending = Object.values(project.pendingImages || {}).find(draft => draft.variantId === variant.id)
        const wardrobe = () => {
          const latest = project.library.characters.find(row => row.id === entry.id), latestVariant = latest.variants.find(row => row.id === variant.id)
          const current = applyLibraryCard(project, kind, cardModel({ id: variant.id, type: 'role' }), { entry: latest, variant: latestVariant })
          const changeImage = async (costume, fields) => {
            const result = await actions.perform(project, 'entry-image', { libraryKind: kind, libraryId: entry.id, variantId: variant.id, costumeId: costume.id, ...fields })
            if (result?.cancelled) return result
            await page.refresh()
            const updated = project.library.characters.find(row => row.id === entry.id).variants.find(row => row.id === variant.id)
            return { ...result, src: costumeImageSource({ image: updated.image }, costume) }
          }
          const saveCostume = async (costume, updated, { makeDefault = false } = {}) => {
            if (updated && !updated.id) updated = { ...updated, id: crypto.randomUUID() }
            const latestCostumes = project.library.characters.find(row => row.id === entry.id).variants.find(row => row.id === variant.id).fields.costumes || []
            const costumes = costume.id ? latestCostumes.flatMap(row => row.id === costume.id ? updated ? [updated] : [] : [row]) : [...latestCostumes, updated]
            const result = await actions.perform(project, 'entry-edit', { libraryKind: kind, libraryId: entry.id, variantId: variant.id, fields: { costumes, ...(makeDefault ? { defaultCostumeId: updated.id } : {}) } })
            if (!result?.cancelled) await page.refresh()
            return result
          }
          const open = costume => {
            header.hidden = body.hidden = true
            costumePage = renderCostumeDetail(current, costume, pending, {
              onImageChange: fields => changeImage(costume, fields), stage: actions.stage,
              busy: targetBusy(project, 'project'),
              onBack: async () => {
                costumePage.remove(); costumePage = null; header.hidden = body.hidden = false
                if (body.querySelector('[data-dirty="true"]')) block.querySelector('.character-wardrobe').replaceWith(wardrobe())
                else paint()
              },
              onSave: (updated, options) => saveCostume(costume, updated, options),
            })
            page.append(costumePage)
          }
          const gallery = characterWardrobe(current, pending, { onOpen: open, onAdd: () => open({}), onImageChange: changeImage, onRemove: async costume => {
            const result = await saveCostume(costume, null)
            if (!result?.cancelled && body.querySelector('[data-dirty="true"]')) block.querySelector('.character-wardrobe').replaceWith(wardrobe())
            return result
          }, stage: actions.stage, busy: targetBusy(project, 'project') })
          if (!(variant.fields.voiceDescription && !variant.fields.look)) gallery.querySelector('.image-text-head').append(generate)
          return gallery
        }
        block.append(wardrobe(), hint, textMaterials(project, card, {
          refresh: () => page.refresh(),
          perform: (_view, _action, { fields }) => actions.perform(project, 'entry-edit', { libraryKind: kind, libraryId: entry.id, variantId: variant.id, fields }),
        }, hint, targetBusy(project, 'project')))
      } else block.append(element('pre', Object.entries(variant.fields).filter(([, value]) => value).map(([key, value]) => `${labels[key] || key}：${value}`).join('\n')))
      const links = libraryLinks(project, kind, entry.id, variant.id)
      block.append(element('p', `关联 ${new Set(links.map(item => item.episodeId)).size} 集${kind === 'characters' ? '' : ' · ' + links.map(item => item.name + ' ' + item.cardId).join('、')}`, 'meta'))
      const pending = Object.values(project.pendingImages || {}).find(draft => draft.variantId === variant.id)
      if (pending) { const img = element('img'); img.src = '/plugins/meiji/image-draft?id=' + encodeURIComponent(pending.draftId); img.alt = '候选图片'; img.style.maxWidth = '240px'; const confirm = element('button', '确认使用'), discard = element('button', '放弃'); confirm.disabled = discard.disabled = targetBusy(project, 'project'); confirm.onclick = () => run('entry-image-confirm', { libraryId: entry.id, variantId: variant.id, draftId: pending.draftId }); discard.onclick = () => run('entry-image-discard', { libraryId: entry.id, variantId: variant.id, draftId: pending.draftId }); portrait.append(img, confirm, discard) }
      for (const link of kind === 'characters' ? [] : links) { const jump = element('button', `查看 ${link.cardId} · ${link.name}`); jump.onclick = () => actions.openLibraryCard?.(link.episodeId, link.cardId, kind); block.append(jump) }
      const edit = element('button', '编辑资料'), importAsset = element('button', '从素材库导入'), clear = element('button', '清除照片')
      const buttons = kind === 'characters' ? [edit, clear] : [edit, clear]
      for (const button of buttons) button.disabled = targetBusy(project, 'project')
      edit.onclick = () => openEditor({ entry, variant })
      importAsset.disabled = targetBusy(project, 'project')
      importAsset.onclick = () => openEditor({ entry, variant, importOnly: true })
      clear.onclick = () => run('entry-image-clear', { libraryId: entry.id, variantId: variant.id })
      if (!(kind === 'characters' && variant.fields.voiceDescription && !variant.fields.look)) { const tools = element('div', '', 'library-image-toolbar'); tools.append(...(kind === 'characters' ? [] : [generate, edit]), importAsset, clear); portrait.append(tools) }
      if (kind !== 'characters') {
        const defaults = element('button', '设为默认'), remove = element('button', `删除${spec.variant}`)
        defaults.disabled = remove.disabled = targetBusy(project, 'project'); remove.disabled ||= links.length > 0 || entry.variants.length < 2
        defaults.onclick = () => run('entry-edit', { libraryId: entry.id, variantId: variant.id, fields: { defaultVariantId: variant.id } })
        remove.onclick = async () => { if (await confirmPanel('确定删除该变体？')) void run('entry-variant-delete', { libraryId: entry.id, variantId: variant.id }) }
        block.append(defaults, remove)
      }
      detail.append(block)
    }
    const remove = element('button', kind === 'characters' ? '删除角色' : '删除条目')
    remove.disabled = targetBusy(project, 'project') || kind !== 'characters' && libraryLinks(project, kind, entry.id).length > 0
    remove.setAttribute('aria-label', `${kind === 'characters' ? '删除角色' : '删除条目'}：${entry.name}`)
    remove.onclick = async () => {
      if(remove.disabled)return
      remove.disabled=true
      const accepted=kind === 'characters' || await confirmPanel('确定删除该库条目？')
      if(accepted)await run('entry-delete',{libraryId:entry.id})
      remove.disabled=targetBusy(project,'project') || kind !== 'characters' && libraryLinks(project,kind,entry.id).length>0
    }
    if (kind === 'characters') { remove.className = 'delete-content character-delete-top'; header.append(remove) }
    else { const danger = element('div', '', 'library-danger-actions'); danger.append(remove); detail.append(danger) }
    body.append(detail)
  }
  page.refresh = async () => { if (actions.load) project = (await actions.load()).project; if (!costumePage && !body.querySelector('[data-dirty="true"]')) paint() }
  paint(); return page
}

export function cardLibraryControls(project, item, actions) {
  const kind = item.type === 'role' ? 'characters' : item.type === 'scene' ? 'scenes' : 'props', spec = libraryKinds[kind]
  const row = element('div', '', 'asset-actions'), entry = project.library?.[kind]?.find(entry => entry.id === item.ref?.libraryId), variant = entry?.variants.find(variant => variant.id === (kind === 'characters' ? entry.defaultVariantId : item.ref?.variantId))
  const label = element('button', entry ? `${entry.name} · ${kind === 'characters' ? (variant?.image.content ? '复用库图' : '库关联') : `${variant?.label || '未知状态'} · ${variant?.image.content ? '复用库图' : '库关联'}`}` : '未关联项目库')
  label.disabled = !entry; label.onclick = () => actions.openLibrary?.(project, kind)
  const selection = element('select'); selection.setAttribute('aria-label', `${item.name}库关联`); selection.append(element('option', '选择条目与变体'))
  selection.firstChild.textContent = kind === 'characters' ? '选择人物' : '选择条目与变体'
  for (const entry of project.library?.[kind] || []) for (const variant of (kind === 'characters' ? entry.variants.filter(item => item.id === entry.defaultVariantId).slice(0, 1) : entry.variants)) { const option = element('option', kind === 'characters' ? entry.name : `${entry.name} · ${variant.label}`); option.value = `${entry.id}/${variant.id}`; if (item.ref?.libraryId === entry.id && (kind === 'characters' || item.ref?.variantId === variant.id)) option.selected = true; selection.append(option) }
  const link = element('button', kind === 'characters' ? '改关联' : '改关联 / 改变体'), unlink = element('button', '解除关联')
  for (const button of [link, unlink]) button.disabled = targetBusy(project, 'project')
  unlink.disabled ||= !entry
  link.onclick = async () => { const [libraryId, variantId] = selection.value.split('/'); if (variantId) try { await actions.perform(project, 'card-link', { libraryKind: kind, itemId: item.id, libraryId, variantId }) } catch (error) { actions.fail?.(error) } }
  unlink.onclick = async () => { try { await actions.perform(project, 'card-unlink', { libraryKind: kind, itemId: item.id }) } catch (error) { actions.fail?.(error) } }
  row.append(label, selection, link, unlink); return row
}
