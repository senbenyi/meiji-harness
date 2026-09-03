export function Breadcrumb(h, { title, onBack, action }) {
  return h('div', { className: 'tf-header' },
    onBack ? h('button', { className: 'tf-back', onClick: onBack }, '← 返回') : null,
    h('span', { className: 'tf-title' }, title),
    action || null,
  )
}
