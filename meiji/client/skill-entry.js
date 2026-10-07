// 各阶段的「查看 skill」入口：显示本阶段技能的状态（基础已修改、本剧有补充、启用的指导、指导素材），点击进入技能详情页。
import { element } from './panel-dom.js'
import { request } from './panel-api.js'

// 流程页的阶段 → 阶段技能。成片入口对应成片技能（其本剧补充追加在最终视频提示词后）。
export const stageSkills = { summary: ['episode', '摘要'], characters: ['outline', '人物角色'], scenes: ['outline', '场景'], outline: ['outline', '剧情'], shots: ['shots', '镜头表'], seconds: ['seconds', '每秒指令'], storyboard: ['storyboard', '文本分镜'], film: ['video', '成片'] }
// 阶段技能 → 在本剧选择指导素材的阶段。
export const assetStageOf = { outline: 'outline', shots: 'shots', 'shot-revise': 'shots', seconds: 'seconds', storyboard: 'storyboard', video: 'film' }

// 全局技能列表（基础修改状态）只读一次，保存基础技能后由详情页调用 forgetSkillList 刷新。
let listing = null
export const skillList = () => (listing ||= request('skills').then(value => value.skills).catch(error => { listing = null; throw error }))
export const forgetSkillList = () => { listing = null }

export function projectSkillStatus(project, id) {
  const skills = project?.skills || {}
  const parts = []
  if (Object.keys(skills.additions?.[id] || {}).length) parts.push('本剧补充')
  const assets = skills.assets?.[assetStageOf[id]]?.length || 0
  if (assets) parts.push(`${assets} 素材`)
  return parts
}

export function skillField(project, stage, actions) {
  const [id, label] = stageSkills[stage]
  const row = element('div', '', 'custom-skill-field')
  const status = element('span', '', 'skill-entry-status')
  const button = element('button', '查看 skill')
  button.type = 'button'
  button.dataset.skill = id
  button.dataset.node = stage
  button.setAttribute('aria-label', `${label} skill`)
  button.onclick = () => project.episodeId && actions.openNodeSkill && ['summary', 'outline', 'characters', 'scenes'].includes(stage) ? actions.openNodeSkill(project, stage, id) : actions.openSkill(project, id)
  // 状态写在按钮上：流程页把按钮移入阶段工具栏时保留（renderStage 设置 data-label）。
  const paint = (modified = false) => {
    const parts = [...(modified ? ['基础已改'] : []), ...(project.episodeId && ['summary', 'outline', 'characters', 'scenes'].includes(stage) ? (project.supplementalSkills?.[stage]?.length ? ['本节点补充'] : []) : projectSkillStatus(project, id))]
    status.textContent = `${label} · skill`
    button.dataset.status = parts.join(' · ')
    button.textContent = (button.dataset.label || '查看 skill') + (parts.length ? ` · ${parts.join(' · ')}` : '')
    button.title = parts.length ? parts.join('，') : '内置技能，未修改'
    button.classList.toggle('skill-customized', parts.length > 0)
  }
  paint()
  if (actions.skillList) Promise.resolve().then(actions.skillList).then(list => paint(Boolean(list.find(skill => skill.id === id)?.modified.length))).catch(() => {})
  row.append(status, button)
  return row
}
