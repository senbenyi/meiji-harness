// 由进行中的操作（含排队中）推导剧集的「执行中」标记，供视图禁用按钮、显示「生成中」。
// 服务端不再保存 activity；数据来自 GET /tasks（与剧集占用同源），排队中的操作同样会禁用该集按钮。
const projectLevel = new Set(['summary'])

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
  const projectTask = live.find(task => !task.episodeId)
  return {
    ...project,
    operationActivity: projectTask ? activityOf(projectTask) : null, busyOperation: projectTask || null,
    episodes: project.episodes.map(episode => {
      const task = live.find(item => item.episodeId === episode.id)
      return { ...episode, operationActivity: task ? activityOf(task) : null, busyOperation: task || projectTask || null }
    }),
  }
}

// 进行中操作的标记：变化时面板需要重绘以更新按钮状态。
export const liveActivityMark = (project, tasks = []) => {
  const view = withLiveActivity(project, tasks)
  return view ? [view.operationActivity || '', ...(view.episodes || []).map(episode => `${episode.id}:${episode.operationActivity || ''}`)].join('|') : ''
}
