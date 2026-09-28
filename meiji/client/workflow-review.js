import { GenerationStatus } from './drama-model.js'
import { element } from './dom.js'

export function appendWorkflowReview(parent, record, generated, busy = false, actionButton, { allowFailureOpinion = false } = {}) {
  const area = element('div', '', 'workflow-review workflow-review-panel')
  if (!generated) return area
  area.dataset.reviewTarget = record?.id || ''
  const check = record?.check
  const paused = record?.status === GenerationStatus.PAUSED
  if (paused) {
    area.append(element('p', '任务已暂停，可重新生成', 'hint'))
    if (actionButton) actionButton.textContent = '重新生成'
  }
  const failed = check?.passed === false || Boolean(record?.error)
  if (failed) area.classList.add('workflow-review-failed')
  if (record?.error) area.append(element('p', `执行未通过：${record.error}`, 'hint warn'))
  const failures = check?.passed === false ? (check.failures || []).filter(Boolean) : []
  if (failures.length) area.append(element('p', `自审未通过：${failures.join('；')}`, 'hint warn workflow-review-failures'))
  if (!failures.length || allowFailureOpinion) {
    const input = element('input', '', 'workflow-review-input')
    input.type = 'text'
    input.placeholder = '修改意见（可选）'
    input.setAttribute('aria-label', '审核意见')
    input.value = record?.review?.text || ''
    input.maxLength = 2000
    input.disabled = false
    input.dataset.reviewKey = record?.id || ''
    let revision = record?.review?.revision || 0, timer, saving = false, queued = false
    const flush = () => {
      if (saving) { queued = true; return }
      if (!record?.id) return
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
  if (actionButton) {
    actionButton.classList.add('workflow-regenerate')
    if (!busy && (generated || failed)) {
      actionButton.textContent = '重新生成'
      actionButton.setAttribute('aria-label', actionButton.textContent)
    }
    const run = actionButton.onclick
    actionButton.onclick = event => { area.dataset.generationMode = 'regenerate'; return run?.call(actionButton, event) }
    const modify = element('button', '提交修改', 'workflow-review-action')
    modify.type = 'button'
    const available = !busy && !actionButton.disabled
    const refresh = () => { modify.disabled = !available || !generated || record?.canModify === false || !(area.querySelector('input')?.value.trim() || (check?.passed === false && check.failures?.some(Boolean))) }
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
  const input = area?.querySelector('input')
  return { generationMode, ...(generationMode === 'modify' && input ? { review: input.value.trim() } : {}) }
}
