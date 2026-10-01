import { element } from './dom.js'

export function textShotView(project, story, actions) {
  const box = element('section', '', 'text-shot-view')
  if (!story?.textShot) return box
  const head = element('div', '', 'workflow-generation-row')
  head.append(element('h4', '文本镜头'))
  const skill = element('button', '查看 skill')
  skill.onclick = () => actions.openNodeSkill ? actions.openNodeSkill(project, `text-shot:${story.id}`, 'text-shot') : actions.openSkill?.(project, 'text-shot')
  const edit = element('button', '编辑文本镜头')
  const rebind = element('button', '重新编排引用')
  const bindingSkill = element('button', '查看引用 skill')
  bindingSkill.onclick = () => actions.openNodeSkill ? actions.openNodeSkill(project, `storyboard:${story.id}`, 'storyboard') : actions.openSkill?.(project, 'storyboard')
  edit.disabled = Boolean(project.activity)
  rebind.disabled = Boolean(project.activity) || story.textShotCheck?.passed !== true
  rebind.onclick = async () => {
    rebind.disabled = true
    try { await actions.perform(project, 'storyboard-bind', { track: story.id }) }
    catch (failure) { error.textContent = failure.message; rebind.disabled = false }
  }
  head.append(skill, edit, rebind, bindingSkill)
  const body = element('p', story.textShot, 'prompt full')
  const form = element('form'); form.hidden = true
  const input = element('textarea'); input.value = story.textShot; input.maxLength = 100000
  input.setAttribute('aria-label', `${story.id} 文本镜头正文`)
  const save = element('button', '保存'); save.type = 'submit'
  const cancel = element('button', '取消'); cancel.type = 'button'
  const error = element('p', '', 'error')
  edit.onclick = () => { form.hidden = false; input.focus() }
  cancel.onclick = () => { form.hidden = true }
  form.onsubmit = async event => {
    event.preventDefault(); save.disabled = true; error.textContent = ''
    try { await actions.perform(project, 'text-shot-edit', { track: story.id, text: input.value, originalText: story.textShot }); form.hidden = true; await actions.refresh?.() }
    catch (failure) { error.textContent = failure.message }
    finally { save.disabled = false }
  }
  form.append(input, save, cancel, error)
  box.append(head, body, form)
  return box
}
