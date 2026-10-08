import { element } from './panel-dom.js'
export { stepKindLabels, targetLabel, stepLabel } from '../shared/run-names.js'

const skillNames = { episode: '剧集摘要', outline: '剧情大纲', shots: '镜头表', 'shot-revise': '单镜修订', seconds: '每秒指令', storyboard: '分镜提示词', video: '成片', 'image-prompt': '图片提示词改写', 'character-image': '人物参考图', 'scene-image': '场景参考图', 'part-image': '道具图片',
  'guidance-action': '动作指导', 'guidance-martial': '武术指导', 'guidance-dialogue': '台词指导', 'guidance-expression': '表情指导', 'guidance-sound': '声音指导' }

// 任务所用技能：任务开始时固定的组合，标明是否为修改后的基础版本、是否含本剧补充。
export function skillsLine(skills = []) {
  if (!skills.length) return null
  const text = skills.map(skill => {
    const notes = [skill.layers.includes('base') ? '基础已修改' : '', skill.layers.includes('node') ? '含本节点补充' : skill.layers.includes('project') ? '含本剧补充' : ''].filter(Boolean)
    return `${skillNames[skill.id] || skill.id}${skill.nodeKey ? ` · ${skill.nodeKey}` : ""}${notes.length ? `（${notes.join('、')}）` : ''}`
  }).join('、')
  const line = element('p', `所用技能：${text}`, 'meta task-skills')
  line.title = skills.map(skill => `${skill.id} ${skill.hash}`).join('\n')
  return line
}
