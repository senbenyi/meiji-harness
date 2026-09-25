import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { feedbackOf } from './feedback.js'
import { element, appendJsonCopy } from './dom.js'

export function draftsOf(project) {
  return (project.episodes || []).flatMap(episode => Object.values(episode.pendingImages || {}).map(draft => ({ ...draft, episodeId: episode.id })))
}

function generatingOf(project) {
  return (project.episodes || []).flatMap(episode => {
    const activity = typeof episode.activity === 'string' ? episode.activity : ''
    if (!activity.startsWith('image:') && !activity.startsWith('pencil:') && activity !== 'confirm-image') return []
    return [{ episodeId: episode.id, activity, error: episode.activityError || '' }]
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
  return { action: 'image', fields: { itemId: gate.itemId, itemName: gate.itemName || gate.name } }
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
      error: entry.error || '',
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
      review: gate.review || '',
      error: '',
    }
  }

  const entry = generating.find(item => matchesActivity(item, gate)) || generating.find(item => item.episodeId === gate.episodeId)
  if (entry?.activity === 'confirm-image') {
    return { ...gate, phase: 'uploading', held: true, error: '' }
  }
  if (entry || gate.held || gate.phase === 'generating' || gate.phase === 'uploading') {
    const episode = (project.episodes || []).find(item => item.id === gate.episodeId)
    const error = entry?.error || episode?.activityError || ''
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
  appendWorkflowReview(reviewArea, record, Boolean(ready), busy)
  const note = reviewArea.querySelector('input')
  if (note && current.review) note.value = current.review
  const status = element('p', '', 'hint warn')
  status.setAttribute('role', 'status')
  if (current.error) status.textContent = current.error

  const setBusy = message => {
    confirm.disabled = discard.disabled = regenerate.disabled = true
    if (note) note.disabled = true
    if (message) status.textContent = message
  }

  for (const button of [confirm, discard, regenerate]) button.type = 'button'

  const canConfirm = Boolean(ready) && record.check.passed === true && !busy
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
    const review = reviewFields(reviewArea).review || ''
    setBusy('正在重新生成…')
    tip.textContent = '正在生成图片，请勿其他操作'
    try { await actions.regenerateImage(project, current, review) }
    catch (error) {
      status.textContent = error.message
      tip.textContent = '生成失败，可放弃或重新生成'
      confirm.disabled = true
      discard.disabled = regenerate.disabled = false
      if (note) note.disabled = false
    }
  }

  buttons.append(confirm, discard, regenerate)
  overlay.append(tip, card, reviewArea, buttons, status)
  return overlay
}
