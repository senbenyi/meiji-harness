// 由进行中的操作（含排队中）推导剧集的「执行中」标记，供视图禁用按钮、显示「生成中」。
// 服务端不再保存 activity；数据来自 GET /tasks（与剧集占用同源），排队中的操作同样会禁用该集按钮。
const projectLevel = new Set(['episode-generate', 'episode-summary-draft'])

export function activityOf(task) {
  if (projectLevel.has(task.action)) return 'episode'
  if (task.action === 'image' || task.action === 'revise-image') return `image:${task.itemId || ''}`
  return task.track ? `${task.action}:${task.track}` : task.action
}

// 返回带 activity 的项目视图（不修改传入对象）；没有进行中操作的剧集 activity 为 null。
export function withLiveActivity(project, tasks = []) {
  if (!project || !Array.isArray(project.episodes)) return project
  const live = tasks.filter(task => !task.projectId || task.projectId === project.id)
  const projectTask = live.find(task => !task.episodeId)
  return {
    ...project,
    activity: projectTask ? activityOf(projectTask) : null,
    episodes: project.episodes.map(episode => {
      const task = live.find(item => item.episodeId === episode.id)
      return { ...episode, activity: task ? activityOf(task) : null }
    }),
  }
}

// 进行中操作的标记：变化时面板需要重绘以更新按钮状态。
export const liveActivityMark = (project, tasks = []) => {
  const view = withLiveActivity(project, tasks)
  return view ? [view.activity || '', ...(view.episodes || []).map(episode => `${episode.id}:${episode.activity || ''}`)].join('|') : ''
}
