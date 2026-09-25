import { gateOf, hasBrief, hasOutline, hasCharacters, hasScenes, hasShots, hasStoryboard } from './flow-rules.js'
export * from './flow-rules.js'
import { feedbackOf } from './feedback.js'
export const tabs = [
  { id: 'script', label: '剧情', steps: ['brief', 'outline'] },
  { id: 'cast', label: '角色场景', steps: ['characters', 'scenes'] },
  { id: 'shots', label: '镜头', steps: ['shots'] },
  { id: 'film', label: '成片', steps: ['film'] },
  { id: 'assembly', label: '合成', steps: ['assembly'] },
]
export function stepRunLabel(project, step) {
  if (project?.activity === step) return '生成中'
  const ready = {
    brief: hasBrief(project),
    outline: hasOutline(project),
    characters: hasCharacters(project),
    scenes: hasScenes(project),
    shots: hasShots(project),
    storyboard: hasStoryboard(project),
  }[step]
  if (!ready) return step === 'storyboard' && project?.storyboard?.length ? '部分生成' : '未生成'
  const check = feedbackOf(project, step).check
  return check.passed === false ? '自检未通过' : check.passed === true ? '已完成' : '待自检'
}


export function tabOf(project) {
  const gate = gateOf(project)
  if (gate === 'done') return 'assembly'
  if (gate === 'storyboard') return 'shots'
  return tabs.find(tab => tab.steps.includes(gate))?.id || 'script'
}

export const nextLabel = {
  brief: '继续写大纲',
  outline: '进入角色场景',
  characters: '继续写场景',
  scenes: '进入镜头',
  shots: '进入分镜',
  storyboard: '进入成片',
  film: '进入合成',
}
