import { GenerationStatus } from '../shared/drama-model.js'
import { overridable, overriddenBy } from '../shared/feedback.js'
import { element } from './dom.js'

export function appendWorkflowReview(parent, record, generated, busy = false, actionButton, { allowFailureOpinion = false } = {}) {
  const area = element('div', '', 'workflow-review workflow-review-panel')
  const check = record?.check
  const failed = check?.passed === false || Boolean(record?.error)
  if (!generated && !failed) return area
  area.dataset.reviewTarget = record?.id || ''
  const paused = record?.status === GenerationStatus.PAUSED
  if (paused) {
    area.append(element('p', '任务已暂停，可重新生成', 'hint'))
    if (actionButton) actionButton.textContent = '重新生成'
  }
  if (failed) area.classList.add('workflow-review-failed')
  if (record?.error) area.append(element('p', `执行未通过：${record.error}`, 'hint warn'))
  const failures = check?.passed === false ? (check.failures || []).filter(Boolean) : []
  if (failures.length) area.append(element('p', `自审未通过：${failures.join('；')}`, 'hint warn workflow-review-failures'))
  else if (check?.passed === false && !record?.error) area.append(element('p', '自审未通过，请查看任务历史中的审核详情。', 'hint warn workflow-review-failures'))
  if (!generated) area.append(element('p', '本次尚未保存可用内容，请查看任务历史中的执行详情，再重新生成。', 'hint'))
  // 人工忽略自审：只在面板上由人操作；放行后显示「人工放行」与原自审意见，与 AI 通过区分。
  const override = overriddenBy(record)
  if (override) area.append(element('p', `人工放行${override.reasons?.length ? `（原自审意见：${override.reasons.join('；')}）` : ''}`, 'hint workflow-review-overridden'))
  let ignore = null
  if (generated && failures.length && !busy && overridable(record)) {
    ignore = element('button', '忽略并通过', 'workflow-review-override')
    ignore.type = 'button'
    ignore.title = '不采纳本次自审意见，视为通过；原自审意见保留在记录中'
    ignore.onclick = () => {
      if (!window.confirm('确定忽略本次自审意见并视为通过？内容再次生成或修改后需重新自审。')) return
      ignore.disabled = true
      ignore.dispatchEvent(new CustomEvent('meiji-review-override', { bubbles: true, composed: true, detail: { key: record.id, episodeId: area.dataset.episodeId, onError() { ignore.disabled = false } } }))
    }
  }
  const compiled = record?.content?.compilerVersion === 1
  if (compiled) area.append(element('p', '由每秒分镜程序组装。剧情修改请到每秒分镜提交意见；也可直接编辑最终提示词。', 'meta'))
  if (generated && !compiled && (!failures.length || allowFailureOpinion)) {
    const input = element('input', '', 'workflow-review-input')
    input.type = 'text'
    input.placeholder = '修改意见（可选）'
    input.setAttribute('aria-label', '审核意见')
    input.value = record?.review?.text || ''
    input.maxLength = 2000
    input.disabled = false
    input.dataset.reviewKey = record?.id || ''
    input.dataset.reviewRevision = String(record?.review?.revision || 0)
    input.dataset.reviewText = input.value
    let revision = record?.review?.revision || 0, timer, saving = false, queued = false
    const flush = () => {
      if (saving) { queued = true; return }
      if (!record?.id) return
      saving = true
      const text = input.value
      input.dispatchEvent(new CustomEvent('meiji-review-draft', { bubbles: true, composed: true, detail: {
        key: record.id, text, revision, episodeId: area.dataset.episodeId,
        onSaved(review) {
          saving = false
          if (review.revision < revision) {
            if (queued || input.dataset.dirty) { queued = false; flush() }
            return
          }
          revision = review.revision
          input.dataset.reviewRevision = String(revision); input.dataset.reviewText = text
          if (input.value === text) delete input.dataset.dirty
          if (queued || input.value !== text) { queued = false; flush() }
        },
        onError() { saving = false; if (queued) { queued = false; flush() } },
      } }))
    }
    input.clearConsumedReview = nextRevision => {
      clearTimeout(timer); queued = false; revision = nextRevision
      input.value = ''; input.dataset.reviewText = ''; input.dataset.reviewRevision = String(revision)
      delete input.dataset.dirty; delete input.dataset.submittedReview
      input.dispatchEvent(new CustomEvent('meiji-review-cleared'))
    }
    input.oninput = () => { delete input.dataset.submittedReview; input.dataset.dirty = 'true'; clearTimeout(timer); timer = setTimeout(flush, 400) }
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
    if (!compiled) {
    const modify = element('button', '提交修改', 'workflow-review-action')
    modify.type = 'button'
    const available = !busy && !actionButton.disabled
    const refresh = () => { modify.disabled = !available || !generated || record?.canModify === false || !(area.querySelector('input')?.value.trim() || (check?.passed === false && check.failures?.some(Boolean))) }
    area.querySelector('input')?.addEventListener('input', refresh)
    area.querySelector('input')?.addEventListener('meiji-review-cleared', refresh)
    modify.onclick = event => { if (modify.disabled) return; area.dataset.generationMode = 'modify'; const input = area.querySelector('input'); if (input) input.dataset.submittedReview = input.value; return run?.call(actionButton, event) }
    refresh()
    area.append(modify)
    }
  }
  // 「忽略并通过」排在「提交修改」之后：按意见修改是首选，忽略是人工兜底。
  if (ignore) area.append(ignore)
  parent.append(area)
  return area
}

export function reviewFields(parent) {
  const area = parent.querySelector(':scope > .workflow-review')
  const generationMode = area?.dataset.generationMode || 'regenerate'
  const input = area?.querySelector('input')
  return { generationMode, ...(generationMode === 'modify' && input ? { review: input.value.trim() } : {}) }
}

// 服务端消费了旧版本后同步保留中的输入框；用户新输入的草稿继续保留。
export function syncConsumedReviewInputs(previous, incoming) {
  const fresh = [...incoming.querySelectorAll('.workflow-review-input')]
  for (const input of previous.querySelectorAll('.workflow-review-input')) {
    const next = fresh.find(value => value.dataset.reviewKey === input.dataset.reviewKey)
    if (!next || next.value || Number(next.dataset.reviewRevision) <= Number(input.dataset.reviewRevision)) continue
    const submitted = input.dataset.submittedReview
    if (submitted === undefined && input.dataset.dirty) continue
    if (input.value !== (submitted ?? input.dataset.reviewText)) continue
    input.clearConsumedReview?.(Number(next.dataset.reviewRevision))
  }
}
