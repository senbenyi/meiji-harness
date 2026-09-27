import { GenerationStatus } from './drama-model.js'
import { element } from './dom.js'

export function appendWorkflowReview(parent, record, generated, busy = false, actionButton) {
  const area = element('div', '', 'workflow-review')
  const check = record?.check
  const paused = record?.status === GenerationStatus.PAUSED
  if (paused) {
    area.append(element('p', '任务已暂停，可重新生成', 'hint'))
    if (actionButton) actionButton.textContent = '重新生成'
  }
  const failed = check?.passed === false || Boolean(record?.error)
  if (generated || failed) {
    area.classList.add('workflow-review-panel')
    if (failed) area.classList.add('workflow-review-failed')
    area.append(element('strong', failed ? '需要修改' : '审核与修改', 'workflow-review-heading'))
  }
  if (record?.error) area.append(element('p', `执行未通过：${record.error}`, 'hint warn'))
  if (!generated) area.append(element('div', '还未生成', 'storyboard-empty'))
  if (generated && check?.passed === false) {
    area.append(element('p', `自检未通过：${check.failures.join('；')}`, 'hint warn'))
  }
  if (generated) {
    const input = element('input', '', 'workflow-review-input')
    input.type = 'text'
    input.placeholder = '修改意见（可选）'
    input.setAttribute('aria-label', '审核意见')
    input.value = record.review?.text || ''
    input.maxLength = 2000
    input.disabled = false
    input.dataset.reviewKey = record.id || ''
    let revision = record.review?.revision || 0, timer, saving = false, queued = false
    const flush = () => {
      if (saving) { queued = true; return }
      if (!record.id) return
      saving = true
      const text = input.value
      input.dispatchEvent(new CustomEvent('meiji-review-draft', { bubbles: true, composed: true, detail: {
        key: record.id, text, revision, episodeId: area.dataset.episodeId,
        onSaved(review) { revision = review.revision; saving = false; if (input.value === text) delete input.dataset.dirty; if (queued || input.value !== text) { queued = false; flush() } },
        onError() { saving = false },
      } }))
    }
    input.oninput = () => { input.dataset.dirty = 'true'; clearTimeout(timer); timer = setTimeout(flush, 400) }
    input.onblur = () => { clearTimeout(timer); if (input.dataset.dirty) flush() }
    area.append(input)
  }
  if (actionButton && (generated || failed)) {
    actionButton.classList.add('workflow-review-action')
    if (!busy) {
      actionButton.textContent = '重新生成'
      actionButton.setAttribute('aria-label', actionButton.textContent)
    }
    area.append(actionButton)
    const run = actionButton.onclick
    actionButton.onclick = event => { area.dataset.generationMode = 'regenerate'; return run?.call(actionButton, event) }
    const modify = element('button', '按意见修改', 'workflow-review-action')
    modify.type = 'button'
    const available = !busy && !actionButton.disabled
    const refresh = () => { modify.disabled = !available || !generated || !(area.querySelector('input')?.value.trim() || (check?.passed === false && check.failures?.some(Boolean))) }
    area.querySelector('input')?.addEventListener('input', refresh)
    modify.onclick = event => { if (modify.disabled) return; area.dataset.generationMode = 'modify'; return run?.call(actionButton, event) }
    refresh()
    area.append(modify)
  }
  parent.append(area)
  return area
}

export function reviewFields(parent) {
  const area = parent.querySelector(':scope > .workflow-review')
  const generationMode = area?.dataset.generationMode || 'regenerate'
  return { generationMode, ...(generationMode === 'modify' ? { review: area?.querySelector('input')?.value.trim() || '' } : {}) }
}
