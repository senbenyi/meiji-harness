import { targetNode, statusLabels } from '../shared/drama-model.js'
import { gateOf, hasSummary, hasOutline, hasCharacters, hasScenes, hasShots, hasStoryboard } from '../shared/generation-gates.js'
export * from '../shared/generation-gates.js'
import { feedbackOf } from '../shared/review-feedback.js'
export const tabs = [
  { id: 'summary', label: '摘要', nodes: ['summary'] },
  { id: 'script', label: '剧情', nodes: ['outline', 'characters', 'scenes'] },
  // 本集资产只展示与维护人物、场景、道具；生成入口仍在剧情页（一次生成大纲、提取与补图），所以不承接流程关卡。
  { id: 'assets', label: '本集资产', nodes: [] },
  { id: 'shots', label: '镜头表', nodes: ['shots'] },
  { id: 'seconds', label: '每秒指令', nodes: ['seconds'] },
  { id: 'film', label: '成片', nodes: ['film'] },
  { id: 'assembly', label: '合成', nodes: ['assembly'] },
]
export function runTabProgress(project, tab) {
  const targets = { summary: ['summary'], script: ['outline', 'characters', 'scenes'], assets: ['characters', 'scenes', 'image'], shots: ['shots'], seconds: ['seconds'], film: ['image', 'storyboard', 'film'], assembly: ['assembly'] }[tab] || []
  const progress = (project.activeRuns || []).flatMap(run => run.progress || []).filter(item => targets.includes(item.target?.split(':')[0]) && item.total)
  return progress.length ? { done: progress.reduce((total, item) => total + item.done, 0), total: progress.reduce((total, item) => total + item.total, 0), paused: progress.some(item => item.paused) } : null
}
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
