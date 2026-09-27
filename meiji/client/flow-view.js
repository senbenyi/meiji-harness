import { targetNode, statusLabels } from './drama-model.js'
import { gateOf, hasSummary, hasOutline, hasCharacters, hasScenes, hasShots, hasStoryboard } from './flow-rules.js'
export * from './flow-rules.js'
import { feedbackOf } from './feedback.js'
export const tabs = [
  { id: 'script', label: '剧情', steps: ['summary', 'outline', 'characters', 'scenes'] },
  { id: 'shots', label: '镜头', steps: ['shots'] },
  { id: 'film', label: '成片', steps: ['film'] },
  { id: 'assembly', label: '合成', steps: ['assembly'] },
]
export function stepRunLabel(project, step) {
  const target = targetNode(project, step === 'summary' ? 'summary' : step)
  return target ? statusLabels[target.status] : '未生成'
}

export function tabOf(project) {
  const gate = gateOf(project)
  if (gate === 'done') return 'assembly'
  if (gate === 'storyboard') return 'shots'
  return tabs.find(tab => tab.steps.includes(gate))?.id || 'script'
}

export const nextLabel = {
  summary: '继续写大纲',
  outline: '进入镜头',
  characters: '继续写场景',
  scenes: '进入镜头',
  shots: '进入分镜',
  storyboard: '进入成片',
  film: '进入合成',
}
