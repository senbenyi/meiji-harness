// 由进行中的操作（含排队中）推导剧集的「执行中」标记，供视图禁用按钮、显示「生成中」。
// 服务端不再保存 activity；数据来自 GET /tasks（与剧集占用同源），排队中的操作同样会禁用该集按钮。
const projectLevel = new Set(['summary'])
import { conflicts, operationScope } from '../shared/operation-conflicts.js'

export function operationBlocked(project, operation) {
  return (project?.liveOperations || []).some(holder => conflicts(holder, { projectId: project.id, episodeId: project.episodeId || null, ...operation }))
}

export function activityOf(task) {
  if (projectLevel.has(task.action)) return 'episode'
  if (['character-image', 'scene-image', 'prop-image'].includes(task.action)) return `image:${task.itemId || ''}`
  const action = { story: 'outline', 'shot-table': 'shots' }[task.action] || task.action
  return task.track ? `${action}:${task.track}` : action
}

// 返回带 activity 的项目视图（不修改传入对象）；没有进行中操作的剧集 activity 为 null。
export function withLiveActivity(project, tasks = []) {
  if (!project || !Array.isArray(project.episodes)) return project
  const live = tasks.filter(task => !task.projectId || task.projectId === project.id)
  const projectTask = live.find(task => operationScope(task).lock === 'project')
  const generationBusy = live.some(task => operationScope(task).kind === 'generate')
  return {
    ...project,
    liveOperations: live, projectBusy: live.length > 0, generationBusy,
    operationActivity: projectTask ? activityOf(projectTask) : null, busyOperation: projectTask || live[0] || null,
    episodes: project.episodes.map(episode => {
      const task = live.find(item => item.episodeId === episode.id)
      return { ...episode, liveOperations: live, generationBusy, projectBusy: live.length > 0, operationActivity: task ? activityOf(task) : projectTask ? 'project-busy' : null, busyOperation: task || projectTask || null }
    }),
  }
}

// 进行中操作的标记：变化时面板需要重绘以更新按钮状态。
export const liveActivityMark = (project, tasks = []) => {
  const view = withLiveActivity(project, tasks)
  return view ? [view.operationActivity || '', ...tasks.map(task => `${task.id || task.operationId || ''}:${task.kind || ''}:${task.lock || ''}`), ...(view.episodes || []).map(episode => `${episode.id}:${episode.operationActivity || ''}`)].join('|') : ''
}
