// 设置页的「技能库」：全部阶段技能、指导技能与共享模块及其修改状态，点击进入技能详情页。
import { element } from './panel-dom.js'

const groups = [['stage', '阶段技能'], ['guidance', '指导技能'], ['shared', '共享模块']]

export function renderSkillLibrary({ load, open, back }) {
  const page = element('section', '', 'settings-page skill-library')
  const back_ = element('button', '← 返回设置', 'back')
  back_.type = 'button'
  back_.onclick = back
  const status = element('p', '正在读取技能库…', 'meta')
  status.setAttribute('role', 'status')
  const list = element('div')
  page.append(back_, element('h2', '技能库'), element('p', '内置技能由插件提供；修改基础 skill 对所有剧生效，本剧补充在各阶段的「查看 skill」中填写。', 'meta'), status, list)
  Promise.resolve().then(load).then(skills => {
    status.textContent = ''
    for (const [kind, title] of groups) {
      const group = element('section', '', 'settings-group')
      group.append(element('h3', title))
      for (const skill of skills.filter(item => item.kind === kind)) {
        const row = element('div', '', 'skill-library-row')
        const state = skill.outdated.length ? `已修改 ${skill.modified.length} 个字段 · 内置已更新` : skill.modified.length ? `已修改 ${skill.modified.length} 个字段` : '内置'
        const button = element('button', '查看')
        button.type = 'button'
        button.setAttribute('aria-label', `查看 ${skill.label}`)
        button.onclick = () => open(skill.id)
        row.append(element('strong', skill.label), element('span', state, `meta skill-state${skill.modified.length ? ' is-modified' : ''}`), button)
        group.append(row)
      }
      list.append(group)
    }
  }).catch(error => { status.textContent = `读取技能库失败：${error.message}` })
  return page
}
