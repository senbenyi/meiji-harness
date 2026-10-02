import { element, tabs } from './dom.js'

function button(text, onclick) {
  const node = element('button', text)
  node.type = 'button'
  node.onclick = onclick
  return node
}

export function renderSkillDetail({ id }, handlers) {
  const page = element('section', '', 'settings-page skill-detail skill-detail-page')
  const header = label => {
    const head = element('header', '', 'skill-page-head')
    head.append(button('← 返回', handlers.back), element('h2', `${label} · skill`))
    return head
  }
  const draw = ({ skill, project }) => {
    const base = element('section', '', 'settings-group skill-base')
    const texts = skill.constraints !== undefined ? [skill.constraints] : (skill.fields || []).filter(field => field.field !== 'protocol').map(field => field.text)
    for (const text of texts) if (text) base.append(element('pre', text, 'skill-text'))
    const fields = (skill.fields || []).filter(field => field.field !== 'protocol')
    const additions = element('section', '', 'settings-group skill-additions')
    additions.hidden = true
    const input = element('textarea')
    input.rows = 12
    input.maxLength = 20000
    input.setAttribute('aria-label', '补充 skill 内容')
    input.value = fields.map(field => project?.additions?.[field.field] || '').filter(Boolean).join('\n\n')
    const editable = Boolean(project && !skill.nodeScoped && fields.length)
    input.disabled = !editable
    additions.append(input)
    const status = element('p', '', 'skill-status')
    status.setAttribute('role', 'status')
    const save = button('保存', async () => {
      save.disabled = true
      status.textContent = '正在保存…'
      try {
        await handlers.saveAddition(Object.fromEntries(fields.map((field, index) => [field.field, index === 0 ? input.value : ''])))
        handlers.changed?.()
        status.textContent = '已保存'
      } catch (error) { status.textContent = error.message }
      finally { save.disabled = false }
    })
    save.disabled = !editable
    additions.append(save, status)
    // 审核 skill：自审使用的验收标准，与基础生产规则分开展示（只读）。
    const review = element('section', '', 'settings-group skill-review')
    review.hidden = true
    if (skill.review) review.append(element('pre', skill.review, 'skill-text'))
    const navigation = tabs('skill', [['base', '基础 skill'], ...(skill.review ? [['review', '审核 skill']] : []), ['addition', '补充 skill']], 'base', key => {
      base.hidden = key !== 'base'
      review.hidden = key !== 'review'
      additions.hidden = key !== 'addition'
    })
    page.replaceChildren(header(skill.label), navigation, base, review, additions)
  }
  const load = () => {
    page.replaceChildren(header(id), element('p', '正在读取…', 'skill-status'))
    Promise.resolve().then(handlers.load).then(draw).catch(error => page.replaceChildren(header(id), element('p', error.message, 'error'), button('重新加载', load)))
  }
  load()
  return page
}
