// 职责：提供稳定剧集身份、分集数据投影。
import { statusError } from '../../utils/errors.js'

export const validEpisodeId = id => typeof id === 'string' && /^episode-[1-9][0-9]*$/.test(id)
export function episodeCountValue(value = 1) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw statusError(400, '计划集数须为 1～100 集')
  return value
}
export function newEpisode(index) {
  return { id: `episode-${index}`, title: `第 ${index} 集`, workflow: { revision: 0, stage: 'configuration', plot: '', storyboard_revision: null, request: null, approval: null, job_id: null } }
}
export function ensureEpisodes(project) {
  if (!project.episodes?.length) throw statusError(409, '项目缺少剧集结构，请新建项目')
  if (project.episodes.length === 1) project.episodes[0].workflow = project.workflow
  return project
}
export function episodeView(project, id) {
  ensureEpisodes(project)
  const episode = project.episodes?.find(item => item.id === id)
  if (!episode) throw statusError(404, '剧集不存在')
  return { ...project, episode_id: id, title: episode.title, workflow: episode.workflow,
    acts: project.acts.filter(act => act.episode_id === id), deliverables: project.deliverables.filter(item => item.episode_id === id) }
}
export function episodeStage(project) {
  const stages = project.episodes.map(item => item.workflow.stage)
  if (project.workflow.request) return project.workflow.stage
  if (stages.every(stage => stage === 'complete')) return 'complete'
  return ['submitting', 'video', 'failed', 'plot-generating', 'storyboard-generating', 'configuration', 'plot', 'storyboard'].find(stage => stages.includes(stage)) || 'configuration'
}
