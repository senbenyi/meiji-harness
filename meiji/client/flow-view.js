import { targetNode, statusLabels } from '../shared/drama-model.js'
import { gateOf, hasSummary, hasOutline, hasCharacters, hasScenes, hasShots, hasStoryboard } from '../shared/generation-gates.js'
export * from '../shared/generation-gates.js'
import { feedbackOf } from '../shared/review-feedback.js'
export const tabs = [
  { id: 'summary', label: '摘要', nodes: ['summary'] },
  { id: 'script', label: '剧情', nodes: ['outline', 'characters', 'scenes'] },
  { id: 'shots', label: '镜头表', nodes: ['shots'] },
  { id: 'seconds', label: '每秒指令', nodes: ['seconds'] },
  { id: 'film', label: '成片', nodes: ['film'] },
  { id: 'assembly', label: '合成', nodes: ['assembly'] },
]
export function stepRunLabel(project, step) {
  const target = targetNode(project, step === 'summary' ? 'summary' : step)
  return target ? statusLabels[target.status] : '未生成'
}

export function tabOf(project) {
  const gate = gateOf(project)
  if (gate === 'done') return 'assembly'
  if (gate === 'storyboard') return 'film'
  return tabs.find(tab => tab.nodes.includes(gate))?.id || 'script'
}
