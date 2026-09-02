function timeAgo(timestamp) {
  const value = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(value)) return '未知时间'
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function ProjectCard(h, { project, busy, progressBar, onSelect, onDelete }) {
  return h('div', { className: 'tf-card', onClick: onSelect },
    h('div', { className: 'tf-card-head' },
      h('div', { className: 'tf-card-title' }, project.title),
      h('button', {
        className: 'tf-btn tf-btn-danger',
        disabled: busy,
        onClick: event => { event.stopPropagation(); onDelete() },
      }, '删除'),
    ),
    progressBar,
    h('div', { className: 'tf-card-meta' },
      `${project.shotsDone}/${project.shotsTotal} 完成　` +
      `${project.characterCount} 角色 · ${project.sceneCount} 场景 · ${timeAgo(project.updatedAt)}`,
    ),
  )
}
