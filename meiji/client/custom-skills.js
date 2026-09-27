import { element } from './dom.js'

export const customSkillStages = { outline: '故事大纲', shots: '镜头表', seconds: '每秒分镜', storyboard: '文本分镜', film: '成片' }

export function customSkillField(project, stage, actions) {
  const row = element('div', '', 'custom-skill-field')
  const button = element('button', project.customSkills?.[stage] ? '编辑补充 skill' : '添加补充 skill')
  button.type = 'button'
  button.setAttribute('aria-label', `${customSkillStages[stage]}自定义 skill`)
  button.onclick = () => actions.openCustomSkill(project, stage)
  row.append(element('span', '自定义 skill'), button)
  return row
}

export function renderCustomSkill(project, stage, { save, back }) {
  const page = element('section', '', 'settings-page')
  const form = document.createElement('form')
  const previous = element('button', '← 返回流程', 'back')
  previous.type = 'button'
  previous.onclick = back
  const input = document.createElement('textarea')
  input.value = project.customSkills?.[stage] || ''
  input.maxLength = 20000
  input.rows = 18
  input.setAttribute('aria-label', '补充 skill 内容')
  input.placeholder = '填写当前阶段的补充要求…'
  const status = element('p', '', 'meta')
  status.setAttribute('role', 'status')
  const submit = element('button', '保存', 'primary')
  submit.type = 'submit'
  page.append(previous, element('h2', `${customSkillStages[stage]} · 自定义 skill`), element('p', '仅用于当前剧集的这一阶段。保存后，下次生成将与基础 skill 一起提交；已有内容不变。清空保存可移除补充。语言与输出格式继续遵循项目配置和基础协议。', 'meta'))
  form.append(input, status, submit)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    try { await save(input.value); status.textContent = '已保存，下次生成生效' }
    catch (error) { status.textContent = error.message }
    finally { submit.disabled = false }
  }
  page.append(form)
  return page
}
