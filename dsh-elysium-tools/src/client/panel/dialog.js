window.__ModuleLoader__.load('elysium-tools/dialog', (require, exports) => {
  const { createElement: h, useEffect, useRef, useState } = require('react')
  function trapFocus(event, root) {
    if (event.key !== 'Tab' || !root) return
    const nodes = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"],summary')].filter(node => node.getClientRects().length)
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
  }
  function Dialog({ title, close, busy, children, footer }) {
    const root = useRef(null), previous = useRef(null)
    useEffect(() => {
      previous.current = document.activeElement
      root.current?.focus()
      return () => previous.current?.focus?.()
    }, [])
    function keyDown(event) {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) close() }
      if (event.key === 'Tab') { event.stopPropagation(); trapFocus(event, root.current) }
    }
    return h('div', { className: 'elysium-dialog-backdrop', onKeyDown: keyDown },
      h('section', { className: 'elysium-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref: root },
        h('header', null, h('h2', null, title), h('button', { disabled: busy, onClick: close, 'aria-label': '关闭对话框' }, '关闭')),
        h('div', { className: 'elysium-dialog-body' }, children),
        h('footer', null, footer, h('button', { disabled: busy, onClick: close }, '取消'))))
  }
  function Editor({ title, initial, fields, save, close, guard }) {
    const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
    const leave = action => dirty ? setPending(() => action) : action()
    useEffect(() => { if (guard) guard.current = leave; return () => { if (guard) guard.current = null } }, [dirty])
    useEffect(() => { if (!dirty) return; const warn = event => { event.preventDefault(); event.returnValue = '' }; window.addEventListener?.('beforeunload', warn); return () => window.removeEventListener?.('beforeunload', warn) }, [dirty])
    async function submit(action = close) {
      if (busy) return
      setBusy(true); setError('')
      try { if (await save(draft) === false) throw new Error('保存失败，请重试'); action() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    function renderField([key, label, type]) {
      const props = { 'aria-label': label, value: draft[key] || '', disabled: busy, onChange: e => setDraft({ ...draft, [key]: e.target.value }) }
      return h('label', { className: 'elysium-field', key }, h('span', null, label), Array.isArray(type)
        ? h('select', props, h('option', { value: '' }, '请选择'), type.map(([value, text]) => h('option', { key: value, value }, text)))
        : h(type === 'textarea' ? 'textarea' : 'input', { ...props, rows: 3 }))
    }
    return h(Dialog, { title, busy, close: () => leave(close), footer: h('button', { className: 'elysium-primary', disabled: busy, onClick: () => submit() }, busy ? '保存中…' : '保存') },
      fields.filter(field => !field[3]).map(renderField),
      fields.some(field => field[3]) ? h('details', null, h('summary', null, '技术详情'), fields.filter(field => field[3]).map(renderField)) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      pending ? h(Dialog, { title: '有未保存的修改', busy, close: () => setPending(null), footer: h('button', { disabled: busy, onClick: () => submit(() => { close(); pending() }) }, '保存并继续') },
        h('button', { disabled: busy, onClick: () => { close(); pending() } }, '放弃修改'), h('button', { onClick: () => setPending(null) }, '继续编辑')) : null)
  }
  Object.assign(exports, { Dialog, Editor, trapFocus })
})
