// Run 查询与展示共用的纯规则。
export const runStatusLabels = { draft: '待确认', running: '执行中', paused: '待处理', completed: '完成', cancelled: '已取消' }
export const runStepStatusLabels = { pending: '等待前置', ready: '等待执行', running: '执行中', done: '完成', paused: '待处理', superseded: '已作废', skipped: '已跳过', cancelled: '已取消' }
export const historyScopes = { summary: ['摘要', ['summary']], script: ['剧情', ['outline', 'characters', 'scenes', 'props']], outline: ['大纲', ['outline']], characters: ['人物角色', ['characters']], scenes: ['场景', ['scenes']], props: ['道具', ['props']], shots: ['镜头表', ['shots']], seconds: ['每秒指令', ['seconds:*']], film: ['成片', ['storyboard:*', 'film:*']], assembly: ['合成', ['assembly']], images: ['图片', ['image:*']], 'project-summary': ['项目摘要', ['project-summary']] }
export function historyTargets(scope = '') {
  if (scope.includes(',')) return scope.split(',')
  const [kind, id] = scope.split(':')
  return id ? kind === 'film' ? [`storyboard:${id}`, `film:${id}`] : [scope] : historyScopes[kind]?.[1] || []
}
const goalLabels = { summary: '摘要', story: '剧情', 'project-summary': '项目摘要', 'shot-table': '镜头表', shots: '镜头表', seconds: '每秒指令', images: '图片', 'character-image': '人物图片', 'scene-image': '场景图片', 'prop-image': '道具图片', film: '成片', assemble: '全片拼接', 'script-sync': '剧本回写', 'script-revise': '剧本修改方案' }
export const runTargetMatches = (target, filter = '') => !filter || filter.split(',').some(value => value.endsWith('*') ? String(target || '').startsWith(value.slice(0, -1)) : target === value)
export const runInScope = (run, episodeId = '') => !episodeId || (episodeId === 'project' ? !run.episodeId : run.episodeId === episodeId || Boolean(run.affectedEpisodes?.includes(episodeId)))
export const orderRuns = (a, b) => Number(['running', 'paused'].includes(b.status)) - Number(['running', 'paused'].includes(a.status)) || String(b.createdAt).localeCompare(String(a.createdAt))
export function runEpisodeLabel(run, project) {
  if (!run.episodeId) return '项目级'
  const index = [...(project?.episodes || [])].reverse().findIndex(item => item.id === run.episodeId)
  return index < 0 ? '剧集' : `第 ${index + 1} 集`
}
export function runGoalLabel(run, project) {
  const goal = run.goal || {}, verb = { regenerate: '重新生成', modify: '修改', review: '审核' }[goal.mode] || '生成'
  // 跨阶段目标显示起止阶段，如「镜头表 → 全片拼接」。
  if (goal.from && goal.from !== goal.to) return `${runEpisodeLabel(run, project)} · ${goalLabels[goal.from] || goal.from} → ${goalLabels[goal.to] || goal.to}`
  return `${runEpisodeLabel(run, project)} · ${goal.to === 'assemble' ? '' : verb}${goalLabels[goal.to] || goal.to || '制作任务'}`
}
