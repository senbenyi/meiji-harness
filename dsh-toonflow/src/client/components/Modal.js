export function Modal(h, { title, onClose, children, actions }) {
  const titleId = 'toonflow-modal-title'
  return h('div', {
    className: 'tf-modal-backdrop',
    onMouseDown: event => {
      if (event.target === event.currentTarget) onClose()
    },
  },
  h('div', {
    className: 'tf-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  },
  h('div', { className: 'tf-modal-head' },
    h('div', { id: titleId, className: 'tf-modal-title' }, title),
    h('button', {
      type: 'button',
      className: 'tf-modal-close',
      'aria-label': '关闭弹窗',
      onClick: onClose,
    }, '×'),
  ),
  h('div', { className: 'tf-modal-body' }, children),
  actions ? h('div', { className: 'tf-modal-actions' }, actions) : null,
  ))
}

export function createProjectDialog(React) {
  const { createElement: h, useState } = React
  return function ProjectDialog({ busy, onClose, onSubmit }) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const submit = event => {
      event.preventDefault()
      if (!busy && title.trim()) void onSubmit({ title: title.trim(), description: description.trim() })
    }
    return h('form', { onSubmit: submit },
      Modal(h, {
        title: '新建项目',
        onClose,
        children: h('div', null,
          h('label', { className: 'tf-form-field' },
            h('span', { className: 'tf-form-label' }, '项目名称'),
            h('input', {
              className: 'tf-input',
              value: title,
              maxLength: 120,
              autoFocus: true,
              disabled: busy,
              onChange: event => setTitle(event.target.value),
            }),
          ),
          h('label', { className: 'tf-form-field' },
            h('span', { className: 'tf-form-label' }, '项目简介（可选）'),
            h('textarea', {
              className: 'tf-textarea',
              value: description,
              maxLength: 2000,
              rows: 4,
              disabled: busy,
              onChange: event => setDescription(event.target.value),
            }),
          ),
        ),
        actions: [
          h('button', { key: 'cancel', type: 'button', className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: onClose }, '取消'),
          h('button', { key: 'submit', type: 'submit', className: 'tf-btn', disabled: busy || !title.trim() }, busy ? '创建中…' : '创建'),
        ],
      }),
    )
  }
}

export function createConfirmDialog(React) {
  const h = React.createElement
  return function ConfirmDialog({ title, message, busy, onClose, onConfirm }) {
    return Modal(h, {
      title,
      onClose,
      children: h('p', { className: 'tf-confirm-message' }, message),
      actions: [
        h('button', { key: 'cancel', type: 'button', className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: onClose }, '取消'),
        h('button', { key: 'confirm', type: 'button', className: 'tf-btn tf-btn-danger-solid', disabled: busy, onClick: onConfirm }, busy ? '删除中…' : '确认删除'),
      ],
    })
  }
}

export function createTextEditDialog(React) {
  const { createElement: h, useState } = React
  return function TextEditDialog({ label, initialValue, busy, onClose, onSubmit }) {
    const [value, setValue] = useState(initialValue || '')
    const submit = event => {
      event.preventDefault()
      if (!busy && value !== initialValue) void onSubmit(value)
    }
    return h('form', { onSubmit: submit },
      Modal(h, {
        title: `编辑${label}`,
        onClose,
        children: h('label', { className: 'tf-form-field' },
          h('span', { className: 'tf-form-label' }, label),
          h('textarea', {
            className: 'tf-textarea',
            value,
            maxLength: 10000,
            rows: 7,
            autoFocus: true,
            disabled: busy,
            onChange: event => setValue(event.target.value),
          }),
        ),
        actions: [
          h('button', { key: 'cancel', type: 'button', className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: onClose }, '取消'),
          h('button', { key: 'submit', type: 'submit', className: 'tf-btn', disabled: busy || value === initialValue }, busy ? '保存中…' : '保存'),
        ],
      }),
    )
  }
}
