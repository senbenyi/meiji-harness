// 职责：提供工作台共用的图标控件、对话框、编辑器与焦点锁定。
window.__ModuleLoader__.load({ id: 'elysium/dialog', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const iconPaths = {
    back: 'M19 12H5m7-7-7 7 7 7', chevronLeft: 'm15 18-6-6 6-6', chevronRight: 'm9 18 6-6-6-6',
    clear: 'm6 6 12 12M18 6 6 18', close: 'm6 6 12 12M18 6 6 18', download: 'M12 3v12m0 0-4-4m4 4 4-4M4 19h16',
    edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Zm10-14 4 4', eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    insert: 'M12 17V3m0 0-4 4m4-4 4 4M4 15v6h16v-6',
    minus: 'M5 12h14', more: 'M5 12h.01M12 12h.01M19 12h.01', plus: 'M12 5v14M5 12h14', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  }
  function Icon({ name }) {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: iconPaths[name] }))
  }
  function IconButton({ name, label, className = '', title = label, ...props }) {
    return h('button', { ...props, type: 'button', className: `elysium-icon-button${className ? ` ${className}` : ''}`, 'aria-label': label, title }, h(Icon, { name }))
  }
  // 次要操作统一收进“⋯”菜单；items 为 [文字, 回调, 是否危险] 列表，空项跳过。
  function Menu({ label, items }) {
    const root = useRef(null), close = () => root.current?.removeAttribute('open')
    return h('details', { className: 'elysium-icon-menu', ref: root },
      h('summary', { 'aria-label': label, title: label }, h(Icon, { name: 'more' })),
      h('div', { className: 'elysium-menu-items' }, items.filter(Boolean).map(([text, onClick, danger]) =>
        h('button', { key: text, type: 'button', className: danger ? 'elysium-danger' : undefined, onClick: () => { close(); onClick() } }, text))))
  }
  const statusText = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
    todo: '未开始', active: '进行中', paused: '已暂停', completed: '已完成' }
  const statusTone = { succeeded: 'success', completed: 'success', running: 'active', queued: 'active', active: 'active', failed: 'error', paused: 'error', cancelled: 'error' }
  function Badge({ status }) {
    return h('span', { className: 'elysium-badge', 'data-tone': statusTone[status] || 'muted' }, statusText[status] || status || '待生成')
  }
  function trapFocus(event, root) {
    if (event.key !== 'Tab' || !root) return
    const nodes = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"],summary')].filter(node => node.getClientRects().length)
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
  }
  function Dialog({ title, close, busy, children, footer, showCancel = true }) {
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
      h('section', { className: 'elysium-workbench-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref: root },
        h('header', null, h('h2', null, title), h(IconButton, { name: 'close', label: '关闭对话框', disabled: busy, onClick: close })),
        h('div', { className: 'elysium-dialog-body' }, children),
        h('footer', null, showCancel ? h('button', { disabled: busy, onClick: close }, '取消') : null, footer)))
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
        ? h('select', props, h('option', { value: '' }, '选择'), type.map(([value, text]) => h('option', { key: value, value }, text)))
        : h(type === 'textarea' ? 'textarea' : 'input', { ...props, rows: 3 }))
    }
    return h(Dialog, { title, busy, close: () => leave(close), footer: h('button', { className: 'elysium-primary', disabled: busy, onClick: () => submit() }, busy ? '保存中…' : '保存') },
      fields.filter(field => !field[3]).map(renderField),
      fields.some(field => field[3]) ? h('details', null, h('summary', null, '技术详情'), fields.filter(field => field[3]).map(renderField)) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      pending ? h(Dialog, { title: '有未保存的修改', busy, close: () => setPending(null), footer: h('button', { disabled: busy, onClick: () => submit(() => { close(); pending() }) }, '保存并继续') },
        h('button', { className: 'elysium-danger', disabled: busy, onClick: () => { close(); pending() } }, '放弃修改'), h('button', { onClick: () => setPending(null) }, '继续编辑')) : null)
  }
  Object.assign(exports, { Badge, Dialog, Editor, Icon, IconButton, Menu })
  return exports
} })
