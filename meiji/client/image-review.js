import { feedbackOf } from '../shared/review-feedback.js'
import { element } from './panel-dom.js'

export function draftsOf(project) {
  return (project.episodes || []).flatMap(episode => Object.values(episode.pendingImages || {}).filter(draft => !draft.slot).map(draft => ({ ...draft, episodeId: episode.id })))
}

function generatingOf(project) {
  return (project.episodes || []).flatMap(episode => {
    const steps = (episode.executionLocks || project.executionLocks || []).filter(step => step.episodeId === episode.id && step.target?.startsWith('image:'))
    if (steps.length) return steps.map(step => ({ episodeId: episode.id, operationActivity: step.target }))
    const activity = typeof episode.operationActivity === 'string' ? episode.operationActivity : ''
    if (!activity.startsWith('image:') && activity !== 'confirm-image') return []
    return [{ episodeId: episode.id, operationActivity: activity }]
  })
}

function matchesDraft(draft, gate) {
  if (!gate) return false
  if (gate.episodeId && draft.episodeId !== gate.episodeId) return false
  if (gate.itemId) return draft.itemId === gate.itemId && !draft.slot && !draft.track
  return true
}

function matchesActivity(entry, gate) {
  if (!gate) return false
  if (gate.episodeId && entry.episodeId !== gate.episodeId) return false
  const activity = entry.operationActivity || ''
  if (gate.itemId) return activity === `image:${gate.itemId}`
  return activity.startsWith('image:') || activity === 'confirm-image'
}

export function gateFromAction(action, fields = {}) {
  return {
    phase: 'generating',
    held: true,
    action,
    episodeId: fields.episodeId || '',
    itemId: fields.itemId || '',
    itemName: fields.itemName || '',
    slot: '',
    track: fields.track || '',
    name: fields.itemName || '图片',
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
      const active = generating.some(entry => matchesActivity(entry, draft))
      return {
        phase: active ? 'generating' : 'ready',
        held: active,
        action: 'image',
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
    const activity = entry.operationActivity || ''
    let itemId = '', track = ''
    if (activity.startsWith('image:')) {
      const parts = activity.slice(6).split(':')
      itemId = parts[0] || ''
    }
    return {
      phase: activity === 'confirm-image' ? 'uploading' : 'generating',
      held: true,
      action: 'image',
      episodeId: entry.episodeId,
      itemId,
      itemName: '',
      slot: '',
      track,
      name: '图片',
      draftId: '',
      previewUrl: '',
      review: '',
      error: '',
    }
  }

  const entry = generating.find(item => matchesActivity(item, gate)) || generating.find(item => item.episodeId === gate.episodeId && item.operationActivity === 'confirm-image')
  const episode = (project.episodes || []).find(item => item.id === gate.episodeId)
  const record = episode ? feedbackOf(episode, `image:${gate.itemId}`) : null
  const run = [...(project.activeRuns || []), ...(episode?.activeRuns || [])].find(item => gate.runId && item.id === gate.runId)
  const stopped = !entry && (record?.error || run && ['paused', 'failed', 'cancelled', 'completed'].includes(run.status))
  if (stopped) {
    const reason = run?.pause?.reasons.find(item => item.target === `image:${gate.itemId}` && item.code !== 'wait_confirm')
    gate = { ...gate, phase: 'error', held: false, ignoreDraftId: '', error: record?.error || reason?.message || gate.error || '' }
  }
  const draft = drafts.find(item => matchesDraft(item, gate) && item.draftId !== gate.ignoreDraftId)
  if (draft) {
    const retained = Boolean(entry && draft.draftId === gate.draftId)
    return {
      ...gate,
      phase: retained ? 'generating' : 'ready',
      held: retained,
      ignoreDraftId: '',
      episodeId: draft.episodeId,
      draftId: draft.draftId,
      previewUrl: draft.previewUrl || '',
      name: draft.name || gate.name,
      review: gate.phase === 'generating' ? '' : gate.review || '',
      error: gate.error || '',
    }
  }

  if (stopped && ['cancelled', 'completed'].includes(run?.status)) return null
  if (entry?.operationActivity === 'confirm-image') {
    return { ...gate, phase: 'uploading', held: true, error: '' }
  }
  if (!entry && gate.phase === 'uploading') return null
  if (entry || gate.held || gate.phase === 'generating' || gate.phase === 'uploading') {
    // 图片错误只读对应图片节点，不读剧集的剧情错误。
    const error = (!entry && episode ? feedbackOf(episode, `image:${gate.itemId}`)?.error : '') || ''
    if (error && !entry) return { ...gate, phase: 'error', held: false, error, previewUrl: '', draftId: '' }
    return { ...gate, phase: 'generating', previewUrl: '', draftId: gate.held ? '' : gate.draftId, error: '' }
  }

  if (gate.phase === 'error') return gate
  return null
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
