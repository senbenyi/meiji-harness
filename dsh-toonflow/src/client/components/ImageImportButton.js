export function createImageImportButton(React) {
  const { createElement: h, useRef } = React

  return function ImageImportButton({ label = '导入图片', busy, ghost = false, onSelect }) {
    const input = useRef(null)
    return h(React.Fragment, null,
      h('input', {
        ref: input,
        type: 'file',
        accept: 'image/png,image/jpeg,image/gif,image/webp',
        style: { display: 'none' },
        onChange: event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void onSelect(file)
        },
      }),
      h('button', {
        type: 'button',
        className: `tf-btn${ghost ? ' tf-btn-ghost' : ''}`,
        disabled: busy,
        onClick: event => {
          event.stopPropagation()
          input.current?.click()
        },
      }, busy ? '导入中…' : label),
    )
  }
}
