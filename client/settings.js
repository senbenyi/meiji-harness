import { element } from './dom.js'

export function renderSettings(project, { save, back }) {
  const page = element('section', '', 'settings-page')
  const form = document.createElement('form')
  const title = element('h2', '设置')
  const returnButton = element('button', '← 返回项目', 'back')
  returnButton.type = 'button'
  returnButton.onclick = back
  page.append(returnButton, title, element('p', project.title, 'meta'))
  const group = element('section', '', 'settings-group')
  group.append(element('h3', '内容生成'))
  const label = element('label', '模型返回语言')
  const select = document.createElement('select')
  select.setAttribute('aria-label', '模型返回语言')
  for (const [value, text] of [['zh-CN', '简体中文'], ['en', 'English（英文）']]) {
    const option = element('option', text)
    option.value = value
    select.append(option)
  }
  select.value = project.outputLanguage || 'zh-CN'
  label.append(select)
  const hint = element('p', '仅影响当前短剧后续生成的内容，已有内容保留原文。界面仍使用中文。', 'meta')
  const error = element('p', '', 'hint warn')
  const submit = element('button', '保存', 'primary')
  submit.type = 'submit'
  error.setAttribute('role', 'status')
  group.append(label, hint)
  form.append(group, error, submit)
  page.append(form)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    error.textContent = ''
    try { await save(project, select.value); error.textContent = '已保存' }
    catch (failure) { error.textContent = failure.message }
    finally { submit.disabled = false }
  }
  return page
}
