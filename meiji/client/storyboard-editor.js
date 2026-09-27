import { element, showToast } from './dom.js'

export function storyboardEditor(project, story, originalText, actions) {
  const box = element('div', '', 'storyboard-editor')
  const edit = element('button', '编辑')
  edit.type = 'button'
  edit.disabled = Boolean(project.activity)
  edit.setAttribute('aria-label', `编辑 ${story.id} 文本分镜`)
  const form = element('form')
  form.hidden = true
  const input = element('textarea')
  const model = project.shots.items.find(shot => shot.id === story.id).storyboard
  let draftRevision = model.draft.revision, timer, pending = Promise.resolve()
  input.value = model.draft.text ?? originalText
  input.required = true
  input.maxLength = 100000
  input.setAttribute('aria-label', `${story.id} 文本分镜正文`)
  const note = element('p', '保存将清除本镜旧审核结论、铅笔分镜、成片及本集合成结果。', 'meta')
  const error = element('p', '', 'error')
  error.setAttribute('role', 'alert')
  const row = element('div', '', 'shot-actions')
  const save = element('button', '保存', 'primary')
  save.type = 'submit'
  const cancel = element('button', '取消')
  cancel.type = 'button'
  edit.onclick = () => { form.hidden = false; edit.hidden = true; input.focus() }
  const persistDraft = text => {
    pending = pending.catch(() => {}).then(() => new Promise((resolve, reject) => {
      input.dispatchEvent(new CustomEvent('meiji-review-draft', { bubbles: true, composed: true, detail: {
        key: model.id, kind: 'text', text, revision: draftRevision,
        onSaved(draft) { draftRevision = draft.revision; resolve() },
        onError(failure) { error.textContent = failure.message; reject(failure) },
      } }))
    }))
    return pending
  }
  input.oninput = () => { input.dataset.dirty = 'true'; clearTimeout(timer); timer = setTimeout(() => { persistDraft(input.value).catch(() => {}) }, 400) }
  if (model.draft.text !== null) { form.hidden = false; edit.hidden = true; input.dataset.dirty = 'true' }
  cancel.onclick = () => { clearTimeout(timer); persistDraft(null).catch(() => {}); input.value = originalText; delete input.dataset.dirty; error.textContent = ''; form.hidden = true; edit.hidden = false }
  form.onsubmit = async event => {
    event.preventDefault()
    if (!input.value.trim()) { error.textContent = '文本分镜不能为空'; return }
    save.disabled = cancel.disabled = input.readOnly = true
    error.textContent = ''
    try {
      const root = box.getRootNode()
      clearTimeout(timer)
      await persistDraft(input.value)
      await actions.perform(project, 'storyboard-text', { track: story.id, text: input.value, originalText, draftRevision })
      originalText = input.value.trim(); delete input.dataset.dirty
      form.hidden = true
      edit.hidden = false
      input.blur()
      await actions.refresh?.()
      showToast('已保存', root)
    } catch (failure) { error.textContent = failure.message || '保存失败，请重试' }
    finally { save.disabled = cancel.disabled = input.readOnly = false }
  }
  row.append(save, cancel)
  form.append(input, note, error, row)
  box.append(edit, form)
  return box
}
