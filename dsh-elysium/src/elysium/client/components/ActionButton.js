export function ActionButton(h, { key, label, disabled, ghost, danger, onClick, title }) {
  const variant = ghost ? ' tf-btn-ghost' : danger ? ' tf-btn-danger' : ''
  return h('button', {
    className: 'tf-btn' + variant,
    key,
    disabled,
    onClick,
    title: title || undefined,
  }, label)
}
