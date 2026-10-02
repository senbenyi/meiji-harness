import { element, tabs } from './dom.js'

const labels = { summary: '摘要', outline: '大纲', characters: '人物角色', scenes: '场景', props: '道具' }
export function renderNodeSkill(project, nodeKey, { load, save, back }) {
  const view = element('section', '', 'skill-detail-page skill-detail')
  const header = element('header', '', 'skill-page-head')
  const returnButton = element('button', '← 返回')
  returnButton.type = 'button'
  returnButton.onclick = back
  header.append(returnButton, element('h2', `${labels[nodeKey] || nodeKey} skill`))
  const status = element('p', '', 'skill-status')
  status.setAttribute('role', 'status')
  const body = element('div')
  view.append(header, body, status)
  const draw = ({ skill, items }) => {
    const base = element('section', '', 'settings-group skill-base')
    const fields = [{ text: skill.constraints }, ...(skill.fields || []).filter(field => field.field !== 'protocol')]
    for (const field of fields.filter(item => item.text)) base.append(element('pre', field.text, 'skill-text'))
    const additions = element('section', '', 'settings-group skill-additions')
    additions.hidden = true
    const input = element('textarea')
    input.setAttribute('aria-label', '补充 skill 内容')
    input.maxLength = 10000
    input.rows = 12
    input.value = items.map(item => item.content).join('\n\n')
    const submit = element('button', '保存')
    submit.type = 'button'
    submit.onclick = async () => {
      submit.disabled = true
      status.textContent = '正在保存…'
      try {
        await save({ content: input.value, replace: true })
        status.textContent = '已保存'
      } catch (failure) { status.textContent = failure.message }
      finally { submit.disabled = false }
    }
    additions.append(input, submit)
    const navigation = tabs('skill', [['base', '基础 skill'], ['addition', '补充 skill']], 'base', key => {
      base.hidden = key !== 'base'
      additions.hidden = key !== 'addition'
    })
    body.replaceChildren(navigation, base, additions)
  }
  const reload = async () => {
    body.replaceChildren(element('p', '正在读取…', 'skill-status'))
    try { draw(await load()); status.textContent = '' }
    catch (failure) {
      status.textContent = failure.message
      const retry = element('button', '重新加载')
      retry.type = 'button'
      retry.onclick = reload
      body.replaceChildren(retry)
    }
  }
  void reload()
  return view
}
