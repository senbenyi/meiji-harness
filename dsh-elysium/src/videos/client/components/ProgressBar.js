export function ProgressBar(h, { done, total }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return h('div', { className: 'tf-progress' },
    h('div', { className: 'tf-progress-fill', style: { width: `${percent}%` } }),
  )
}
