// 业务模板与执行定义分离；纯规则可被预览、会话和测试共用。
export const runStages = ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble']
export const stageDependencies = { summary: [], story: ['summary'], images: ['story'], shots: ['story'], seconds: ['shots'], film: ['seconds'], assemble: ['film'] }
export const textTargets = {
  summary: { taskType: 'summary', action: 'episode-generate', scope: 'project' },
  'project-summary': { taskType: 'project-summary', action: 'project-summary', scope: 'project' },
  outline: { taskType: 'outline', action: 'outline', scope: 'project' },
  characters: { taskType: 'characters', action: 'characters', scope: 'project' },
  scenes: { taskType: 'scenes', action: 'scenes', scope: 'project' },
  props: { taskType: 'props', action: 'props', scope: 'project' },
  shots: { taskType: 'shot-table', action: 'shots', scope: 'episode' },
  seconds: { taskType: 'shot-seconds', action: 'shot-seconds', scope: 'episode' },
  script: { taskType: 'script-revise', action: 'script-revise', scope: 'project' },
}
export function normalizeRunGoal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请指定制作目标')
  if (Object.keys(input).some(key => !['from', 'to', 'mode', 'scope', 'feedback', 'requirements', 'draft', 'durationSeconds', 'parts', 'image'].includes(key))) throw new Error('制作目标含不支持的字段')
  const goal = structuredClone(input)
  goal.to = goal.to === 'shot-table' ? 'shots' : goal.to
  goal.from = goal.from === 'shot-table' ? 'shots' : goal.from
  if (![...runStages, 'project-summary', 'script-revise', 'script-sync'].includes(goal.to)) throw new Error('制作终点无效')
  if (goal.from && (!runStages.includes(goal.from) || !runStages.includes(goal.to) || runStages.indexOf(goal.from) > runStages.indexOf(goal.to))) throw new Error('制作起点无效')
  goal.mode ||= goal.feedback ? 'modify' : 'generate'
  if (!['generate', 'regenerate', 'modify', 'review'].includes(goal.mode)) throw new Error('制作模式无效')
  if (goal.feedback !== undefined && (typeof goal.feedback !== 'string' || !goal.feedback.trim())) throw new Error('修改意见不能为空')
  // 修改可不带新意见：此时依据正文上已有的自审问题修订（没有任何问题或意见时由步骤拒绝）。
  if (goal.requirements !== undefined && typeof goal.requirements !== 'string') throw new Error('生成要求须为文字')
  goal.scope ||= {}
  if (typeof goal.scope !== 'object' || Array.isArray(goal.scope) || Object.keys(goal.scope).some(key => !['only', 'tracks', 'itemIds', 'fromEpisode', 'library'].includes(key))) throw new Error('目标范围无效')
  if (goal.scope.library && (goal.to !== 'images' || typeof goal.scope.library !== 'object' || Object.keys(goal.scope.library).some(key => !['kind', 'id', 'variantId'].includes(key)) || !['characters', 'scenes', 'props'].includes(goal.scope.library.kind) || !goal.scope.library.id || !goal.scope.library.variantId)) throw new Error('库图片范围无效')
  for (const key of ['tracks', 'itemIds']) if (goal.scope[key] !== undefined && (!Array.isArray(goal.scope[key]) || !goal.scope[key].length || goal.scope[key].some(id => typeof id !== 'string' || !id.trim()) || new Set(goal.scope[key]).size !== goal.scope[key].length)) throw new Error('对象范围不存在或重复')
  if (goal.scope.only && (goal.to !== 'story' || !['outline', 'characters', 'scenes', 'props'].includes(goal.scope.only))) throw new Error('剧情对象无效')
  if (goal.scope.tracks && !['shots', 'seconds', 'film'].includes(goal.to)) throw new Error('此目标不支持镜头范围')
  if (goal.scope.itemIds && goal.to !== 'images') throw new Error('此目标不支持图片范围')
  if (goal.scope.fromEpisode !== undefined && (goal.to !== 'script-revise' || !Number.isInteger(goal.scope.fromEpisode) || goal.scope.fromEpisode < 1)) throw new Error('后续剧情起点无效')
  if (goal.durationSeconds !== undefined && (!Number.isInteger(goal.durationSeconds) || goal.durationSeconds < 1 || goal.durationSeconds > 86400)) throw new Error('剧集时长无效')
  if (goal.draft !== undefined && (typeof goal.draft !== 'boolean' || goal.to !== 'summary')) throw new Error('仅摘要支持草稿')
  if (goal.parts && (goal.to !== 'film' || !['storyboard', 'video', 'tail'].includes(goal.parts))) throw new Error('成片范围无效')
  // 单卡生图的画面选项：画幅、是否带参考图、以哪张候选图为修改基图。
  if (goal.image !== undefined && (goal.to !== 'images' || !goal.image || typeof goal.image !== 'object' || Array.isArray(goal.image) || Object.keys(goal.image).some(key => !['aspect', 'useReference', 'draftId'].includes(key)) || goal.image.aspect !== undefined && !/^\d{2,5}x\d{2,5}$/.test(goal.image.aspect) || goal.image.useReference !== undefined && typeof goal.image.useReference !== 'boolean' || goal.image.draftId !== undefined && (typeof goal.image.draftId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(goal.image.draftId)))) throw new Error('图片选项无效')
  return goal
}
export function goalForRunTarget(target, changes = {}) {
  const [kind, id] = String(target).split(':')
  const to = ['outline', 'characters', 'scenes', 'props'].includes(kind) ? 'story' : ['storyboard', 'film'].includes(kind) ? 'film' : kind === 'image' ? 'images' : kind === 'script' ? 'script-revise' : kind === 'assembly' ? 'assemble' : kind
  return { to, scope: ['outline', 'characters', 'scenes', 'props'].includes(kind) ? { only: kind } : id ? kind === 'image' ? { itemIds: [id] } : { tracks: [id] } : {}, ...changes }
}
