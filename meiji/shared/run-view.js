import { goalProductLabel, goalActionLabel } from './run-names.js'
// Run 查询与展示共用的纯规则。
export const runStatusLabels = { draft: '未生成', running: '生成中', paused: '待处理', completed: '已通过', failed: '未通过', cancelled: '已取消' }
export const runStatusFilters = [['draft', '未生成'], ['running', '生成中'], ['failed', '未通过'], ['paused', '待处理'], ['completed', '已通过'], ['cancelled', '已取消']]
const failedPauseCodes = new Set(['step_failed', 'review_exhausted'])
export function runDisplayStatus(run) {
  if (run.status === 'failed') return { key: 'failed', label: '未通过' }
  const failedStep = run.steps?.some(step => step.status === 'paused' && (step.output?.passed === false || step.error))
  if (run.status === 'paused' && (run.pause?.reasons?.some(reason => failedPauseCodes.has(reason.code)) || failedStep)) return { key: 'failed', label: '未通过' }
  return { key: ({ draft: 'not-generated', running: 'generating', paused: 'paused', completed: 'passed', cancelled: 'cancelled' })[run.status] || run.status, label: runStatusLabels[run.status] || run.status }
}
export const runStepStatusLabels = { pending: '等待前置', ready: '等待执行', running: '执行中', done: '完成', paused: '待处理', failed: '未通过', superseded: '已作废', skipped: '已跳过', cancelled: '已取消' }
export const historyScopes = { summary: ['摘要', ['summary']], script: ['剧情', ['outline']], assets: ['本集资产', ['characters', 'image:*']], outline: ['大纲', ['outline']], characters: ['人物角色', ['characters']], scenes: ['场景', ['scenes']], props: ['道具', ['props']], shots: ['镜头表', ['shots']], seconds: ['每秒指令', ['seconds:*']], film: ['成片', ['storyboard:*', 'film:*']], assembly: ['合成', ['assembly']], images: ['图片', ['image:*']], 'project-summary': ['项目摘要', ['project-summary']] }
export function historyTargets(scope = '') {
  if (scope.includes(',')) return scope.split(',')
  const [kind, id] = scope.split(':')
  return id ? kind === 'film' ? [`storyboard:${id}`, `film:${id}`] : [scope] : historyScopes[kind]?.[1] || []
}
export const runTargetMatches = (target, filter = '') => !filter || filter.split(',').some(value => value.endsWith('*') ? String(target || '').startsWith(value.slice(0, -1)) : target === value)
export const runInScope = (run, episodeId = '') => !episodeId || (episodeId === 'project' ? !run.episodeId : run.episodeId === episodeId || Boolean(run.affectedEpisodes?.includes(episodeId)))
export const orderRuns = (a, b) => Number(['running', 'paused'].includes(b.status)) - Number(['running', 'paused'].includes(a.status)) || String(b.createdAt).localeCompare(String(a.createdAt))
export function runEpisodeLabel(run, project) {
  if (!run.episodeId) return '项目级'
  const index = [...(project?.episodes || [])].reverse().findIndex(item => item.id === run.episodeId)
  return index < 0 ? '剧集' : `第 ${index + 1} 集`
}
export function runGoalLabel(run, project) {
  const goal = run.goal || {}, scope = goal.scope || {}
  const tracks = scope.tracks?.length ? scope.tracks.join('、') : ''
  const items = scope.itemIds?.length ? scope.itemIds.join('、') : scope.library?.id || ''
  const range = tracks || items
  const product = goalProductLabel(goal)
  if (goal.from && goal.from !== goal.to) return `${runEpisodeLabel(run, project)} · ${goalActionLabel(goal)}${goalProductLabel({to:goal.from})} → ${product}${range ? ' · '+range : ''}`
  return `${runEpisodeLabel(run, project)} · ${goalActionLabel(goal)}${range ? range : ''}${product}`
}
