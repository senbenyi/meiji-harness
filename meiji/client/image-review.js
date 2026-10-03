import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { feedbackOf } from '../shared/review-feedback.js'
import { element, appendJsonCopy } from './panel-dom.js'

export function draftsOf(project) {
  return (project.episodes || []).flatMap(episode => Object.values(episode.pendingImages || {}).map(draft => ({ ...draft, episodeId: episode.id })))
}

function generatingOf(project) {
  return (project.episodes || []).flatMap(episode => {
    const activity = typeof episode.activity === 'string' ? episode.activity : ''
    if (!activity.startsWith('image:') && !activity.startsWith('pencil:') && activity !== 'confirm-image') return []
    return [{ episodeId: episode.id, activity }]
  })
}

function matchesDraft(draft, gate) {
  if (!gate) return false
  if (gate.episodeId && draft.episodeId !== gate.episodeId) return false
  if (gate.track) return draft.track === gate.track
  if (gate.slot) return draft.itemId === gate.itemId && draft.slot === gate.slot
  if (gate.itemId) return draft.itemId === gate.itemId && !draft.slot && !draft.track
  return true
}

function matchesActivity(entry, gate) {
  if (!gate) return false
  if (gate.episodeId && entry.episodeId !== gate.episodeId) return false
  const activity = entry.activity || ''
  if (gate.track) return activity === `pencil:${gate.track}`
  if (gate.slot) return activity === `image:${gate.itemId}:${gate.slot}`
  if (gate.itemId) return activity === `image:${gate.itemId}`
  return activity.startsWith('image:') || activity.startsWith('pencil:') || activity === 'confirm-image'
}

export function gateFromAction(action, fields = {}) {
  return {
    phase: 'generating',
    held: true,
    action,
    episodeId: fields.episodeId || '',
    itemId: fields.itemId || '',
    itemName: fields.itemName || '',
    slot: fields.slot || '',
    track: fields.track || '',
    name: fields.itemName || (fields.track ? `${fields.track} 铅笔分镜` : '图片'),
    aspect: fields.aspect || '',
    useReference: Boolean(fields.useReference),
    draftId: '',
    previewUrl: '',
    review: '',
    error: '',
  }
}

export function regenerateFields(gate, review = '') {
  const note = String(review || '').trim()
  if (gate.track) return { action: 'pencil', fields: { track: gate.track, ...(note ? { review: note } : {}) } }
  if (gate.slot) {
    return {
      action: 'part-image',
      fields: {
        itemId: gate.itemId,
        itemName: gate.itemName || gate.name,
        slot: gate.slot,
        ...(note ? { review: note } : {}),
      },
    }
  }
  if (note) {
    return {
      action: 'revise-image',
      fields: {
        itemId: gate.itemId,
        itemName: gate.itemName || gate.name,
        instruction: note,
      },
    }
  }
  return { action: 'image', fields: { itemId: gate.itemId, itemName: gate.itemName || gate.name, ...(gate.aspect ? { aspect: gate.aspect } : {}), ...(gate.useReference ? { useReference: true } : {}) } }
}

export function syncImageGate(project, gate) {
  const drafts = draftsOf(project)
  const generating = generatingOf(project)

  if (!gate) {
    const draft = drafts[0]
    if (draft) {
      return {
        phase: 'ready',
        held: false,
        action: draft.track ? 'pencil' : draft.slot ? 'part-image' : 'image',
        episodeId: draft.episodeId,
        itemId: draft.itemId || '',
        itemName: draft.name || '',
        slot: draft.slot || '',
        track: draft.track || '',
        name: draft.name || '待确认图片',
        aspect: draft.aspect || '',
        useReference: Boolean(draft.useReference),
        draftId: draft.draftId,
        previewUrl: draft.previewUrl || '',
        review: '',
        error: '',
      }
    }
    const entry = generating[0]
    if (!entry) return null
    const activity = entry.activity || ''
    let itemId = '', slot = '', track = ''
    if (activity.startsWith('pencil:')) track = activity.slice(7)
    else if (activity.startsWith('image:')) {
      const parts = activity.slice(6).split(':')
      itemId = parts[0] || ''
      slot = parts[1] || ''
    }
    return {
      phase: activity === 'confirm-image' ? 'uploading' : 'generating',
      held: true,
      action: track ? 'pencil' : slot ? 'part-image' : 'image',
      episodeId: entry.episodeId,
      itemId,
      itemName: '',
      slot,
      track,
      name: track ? `${track} 铅笔分镜` : '图片',
      draftId: '',
      previewUrl: '',
      review: '',
      error: '',
    }
  }

  const draft = drafts.find(item => matchesDraft(item, gate) && item.draftId !== gate.ignoreDraftId)
  if (draft) {
    return {
      ...gate,
      phase: 'ready',
      held: false,
      ignoreDraftId: '',
      episodeId: draft.episodeId,
      draftId: draft.draftId,
      previewUrl: draft.previewUrl || '',
      name: draft.name || gate.name,
      review: gate.phase === 'generating' ? '' : gate.review || '',
      error: '',
    }
  }

  const entry = generating.find(item => matchesActivity(item, gate)) || generating.find(item => item.episodeId === gate.episodeId)
  if (entry?.activity === 'confirm-image') {
    return { ...gate, phase: 'uploading', held: true, error: '' }
  }
  if (entry || gate.held || gate.phase === 'generating' || gate.phase === 'uploading') {
    const episode = (project.episodes || []).find(item => item.id === gate.episodeId)
    // 图片错误只读对应图片节点，不读剧集的剧情错误。
    const error = (!entry && episode ? feedbackOf(episode, { action: gate.action || (gate.track ? 'pencil' : gate.slot ? 'part-image' : 'image'), track: gate.track, itemId: gate.itemId, slot: gate.slot })?.error : '') || ''
    if (error && !entry) return { ...gate, phase: 'error', held: false, error, previewUrl: '', draftId: '' }
    return { ...gate, phase: 'generating', previewUrl: '', draftId: gate.held ? '' : gate.draftId, error: '' }
  }

  if (gate.phase === 'error') return gate
  return null
}

export function renderImageReview(project, actions, gate) {
  const current = syncImageGate(project, gate)
  if (!current) return null

  const ready = current.phase === 'ready' && current.previewUrl
  const busy = current.phase === 'generating' || current.phase === 'uploading' || current.held
  const overlay = element('div', '', 'image-review-overlay')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', '图片生成预览')

  const tip = element(
    'p',
    current.phase === 'error' ? '生成失败，可放弃或重新生成'
      : ready ? '生成完成，请确认、放弃或重新生成'
        : '正在生成图片，请勿其他操作',
    'image-review-tip',
  )
  tip.setAttribute('role', 'status')

  const card = element('article', '', 'image-review-card')
  if (ready) {
    const image = document.createElement('img')
    image.src = current.previewUrl
    image.alt = current.name || '待确认图片'
    const preview = element('a')
    preview.href = current.previewUrl
    preview.target = '_blank'
    preview.rel = 'noopener'
    preview.setAttribute('aria-label', '查看完整图片')
    preview.append(image)
    card.append(preview, element('strong', current.name || '待确认图片'))
  } else {
    card.append(element('strong', current.name || '待生成图片'))
  }

  appendJsonCopy(card, project.pendingImages?.[current.draftId])
  const buttons = element('div', '', 'image-review-actions')
  const confirm = element('button', '确认', 'primary')
  const discard = element('button', '放弃')
  const regenerate = element('button', '重新生成')
  const owner = project.episodes?.find(episode => episode.id === current.episodeId) || project
  const target = { action: current.track ? 'pencil' : current.slot ? 'part-image' : 'image', track: current.track, itemId: current.itemId, slot: current.slot }
  const record = feedbackOf(owner, target)
  const reviewArea = element('div', '', 'image-review-fields')
  let note
  const status = element('p', '', 'hint warn')
  status.setAttribute('role', 'status')
  if (current.error) status.textContent = current.error

  const setBusy = message => {
    confirm.disabled = discard.disabled = regenerate.disabled = true
    if (note) note.disabled = true
    if (message) status.textContent = message
  }

  for (const button of [confirm, discard, regenerate]) button.type = 'button'

  // 图片没有 AI 自审：候选图就绪即可由人确认（确认成功后服务端才把节点记为通过）。
  const canConfirm = Boolean(ready) && !busy
  const canDiscard = (Boolean(ready) || current.phase === 'error') && !busy
  const canRegenerate = (Boolean(ready) || current.phase === 'error') && !busy
  confirm.disabled = !canConfirm
  discard.disabled = !canDiscard
  regenerate.disabled = !canRegenerate

  if (current.phase === 'uploading') setBusy('正在上传…')

  confirm.onclick = async () => {
    if (!canConfirm || !current.draftId) return
    setBusy('正在上传…')
    try { await actions.reviewImage(project, current.episodeId, current.draftId, 'confirm-image') }
    catch (error) {
      status.textContent = error.message
      confirm.disabled = discard.disabled = regenerate.disabled = false
      if (note) note.disabled = false
    }
  }
  discard.onclick = async () => {
    if (!canDiscard) return
    setBusy('正在处理…')
    try {
      if (current.draftId) await actions.reviewImage(project, current.episodeId, current.draftId, 'discard-image')
      else await actions.closeImageReview()
    } catch (error) {
      status.textContent = error.message
      confirm.disabled = discard.disabled = regenerate.disabled = false
      if (note) note.disabled = false
    }
  }
  regenerate.onclick = async () => {
    if (!canRegenerate) return
    const fields = reviewFields(reviewArea)
    setBusy('正在重新生成…')
    tip.textContent = '正在生成图片，请勿其他操作'
    try { await actions.regenerateImage(project, current, fields) }
    catch (error) {
      status.textContent = error.message
      tip.textContent = '生成失败，可放弃或重新生成'
      confirm.disabled = true
      discard.disabled = regenerate.disabled = false
      if (note) note.disabled = false
    }
  }

  buttons.append(confirm, discard)
  const heading = element('div', '', 'workflow-generation-row')
  heading.append(tip, regenerate)
  reviewArea.querySelector('.workflow-review')?.remove()
  appendWorkflowReview(reviewArea, record, Boolean(ready), busy, regenerate)
  const opinion = reviewArea.querySelector('input')
  note = opinion
  if (opinion && current.review) { opinion.value = current.review; opinion.dispatchEvent(new Event('input')) }
  overlay.append(heading, card, reviewArea, buttons, status)
  return overlay
}

export function detailOwnsImage(context, gate) {
  const open = context?.character || context?.scene
  return Boolean(open && gate && !gate.track && gate.itemId === open.itemId && (!gate.episodeId || gate.episodeId === open.episodeId))
}

export function renderDetailImageActions(project, actions, gate, { regenerate: showRegenerate = true, blocked = false } = {}) {
  if (!gate || gate.track) return null
  const ready = gate.phase === 'ready' && gate.previewUrl
  const busy = gate.phase === 'generating' || gate.phase === 'uploading' || gate.held || blocked
  const bar = element('div', '', 'detail-image-actions')
  const tip = element('p', gate.phase === 'error' ? (gate.error || '生成失败') : ready ? '请确认这张图' : gate.phase === 'uploading' ? '正在上传' : '正在生成', 'detail-image-status')
  tip.setAttribute('role', 'status')
  const buttons = element('div', '', 'detail-image-buttons')
  const discard = element('button', '放弃')
  const confirm = element('button', '确定', 'primary')
  const regenerate = element('button', '重新生成')
  for (const button of [discard, confirm, regenerate]) button.type = 'button'
  const canConfirm = Boolean(ready) && !busy
  const canDiscard = (Boolean(ready) || gate.phase === 'error') && !busy
  const canRegenerate = (Boolean(ready) || gate.phase === 'error') && !busy
  confirm.disabled = !canConfirm
  discard.disabled = !canDiscard
  regenerate.disabled = !canRegenerate
  const status = element('p', '', 'hint warn detail-image-error')
  status.setAttribute('role', 'status')
  const setBusy = message => {
    confirm.disabled = discard.disabled = regenerate.disabled = true
    if (message) tip.textContent = message
  }
  confirm.onclick = async () => {
    if (!canConfirm || !gate.draftId) return
    setBusy('正在上传')
    try { await actions.reviewImage(project, gate.episodeId, gate.draftId, 'confirm-image') }
    catch (error) {
      status.textContent = error.message
      confirm.disabled = discard.disabled = regenerate.disabled = false
    }
  }
  discard.onclick = async () => {
    if (!canDiscard) return
    setBusy('正在处理')
    try {
      if (gate.draftId) await actions.reviewImage(project, gate.episodeId, gate.draftId, 'discard-image')
      else await actions.closeImageReview()
    } catch (error) {
      status.textContent = error.message
      confirm.disabled = discard.disabled = regenerate.disabled = false
    }
  }
  regenerate.onclick = async () => {
    if (!canRegenerate) return
    setBusy('正在生成')
    try { await actions.regenerateImage(project, gate, { generationMode: 'regenerate' }) }
    catch (error) {
      status.textContent = error.message
      tip.textContent = '生成失败'
      confirm.disabled = true
      discard.disabled = regenerate.disabled = false
    }
  }
  buttons.append(discard, confirm)
  if (showRegenerate) buttons.append(regenerate)
  bar.append(tip, buttons, status)
  return bar
}
