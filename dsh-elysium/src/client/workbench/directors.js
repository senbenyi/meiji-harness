// 职责：列出导演 Skill，并在工作台直接编辑 SKILL.md 全文。
window.__ModuleLoader__.load({ id: 'elysium/directors', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { fetchDirectors, fetchDirector, createDirector, saveDirector, reorderDirectors, deleteDirector } = require('elysium/director-api')

  function DirectorList() {
    const [items, setItems] = useState([]), [creating, setCreating] = useState(false), [displayName, setDisplayName] = useState('')
    const [editing, setEditing] = useState(null), [draft, setDraft] = useState(''), [dragging, setDragging] = useState(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchDirectors())
    useEffect(() => { let active = true; setBusy(true); fetchDirectors().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    async function create(event) {
      event.preventDefault()
      if (!displayName.trim()) return
      await run(async () => {
        const item = await createDirector({ display_name: displayName.trim() })
        await refresh(); setCreating(false); setDisplayName(''); setEditing(item.name); setDraft(item.content)
      })
    }
    async function edit(item) {
      await run(async () => { const value = await fetchDirector(item.name); setEditing(item.name); setDraft(value.content); setCreating(false) })
    }
    async function save(event) {
      event.preventDefault()
      if (await run(async () => { await saveDirector({ name: editing, content: draft }); await refresh() })) setEditing(null)
    }
    async function drop(target, event) {
      event.preventDefault()
      const source = dragging
      setDragging(null)
      if (!source || source === target) return
      const previous = items, ordered = items.filter(item => item.name !== source)
      const targetIndex = ordered.findIndex(item => item.name === target)
      const bounds = event.currentTarget.getBoundingClientRect()
      ordered.splice(targetIndex + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0), 0, items.find(item => item.name === source))
      setItems(ordered)
      if (!await run(async () => setItems(await reorderDirectors(ordered.map(item => item.name))))) setItems(previous)
    }
    return h('div', { className: 'elysium-directors' },
      h('div', { className: 'elysium-director-heading' },
        h('div', null, h('h1', null, '导演 Skill'), h('p', null, '编辑完整 SKILL.md；项目引用保持稳定')),
        h('button', { type: 'button', className: 'elysium-director-add', 'aria-label': creating || editing ? '取消编辑导演' : '添加导演', disabled: busy, onClick: () => { setCreating(!creating && !editing); setEditing(null); setDisplayName(''); setError('') } }, creating || editing ? '取消' : '＋ 添加导演')),
      creating ? h('form', { className: 'elysium-director-create', onSubmit: create },
        h('label', { className: 'elysium-director-field' }, h('span', null, '导演显示名'), h('input', { autoFocus: true, 'aria-label': '导演显示名', value: displayName, disabled: busy, onChange: event => setDisplayName(event.target.value) })),
        h('footer', null, h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !displayName.trim() }, '创建并编辑 Skill'))) : null,
      editing ? h('form', { className: 'elysium-director-create', onSubmit: save },
        h('h2', null, `编辑 ${items.find(item => item.name === editing)?.display_name || editing}`),
        h('label', { className: 'elysium-director-field elysium-director-works-field' }, h('span', null, 'SKILL.md 全文'), h('textarea', { 'aria-label': 'SKILL.md 全文', value: draft, disabled: busy, rows: 24, onChange: event => setDraft(event.target.value) })),
        h('footer', null, h('button', { className: 'elysium-primary', type: 'submit', disabled: busy }, busy ? '保存中…' : '保存 Skill'))) : null,
      error ? h('p', { role: 'alert' }, error, !items.length ? h('button', { onClick: () => run(refresh) }, '重试') : null) : null,
      busy && !items.length ? h('p', { role: 'status' }, '正在读取导演…') : null,
      !busy && !error && !items.length ? h('p', { className: 'elysium-empty' }, '还没有导演，点击右上角添加') : null,
      h('div', { className: 'elysium-director-list' }, items.map(item =>
        h('article', { className: 'elysium-director-card', key: item.name, draggable: !busy, 'data-dragging': dragging === item.name || undefined, onDragStart: event => { event.dataTransfer.effectAllowed = 'move'; setDragging(item.name) }, onDragOver: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, onDrop: event => drop(item.name, event), onDragEnd: () => setDragging(null) },
          h('header', { className: 'elysium-director-card-heading' }, h('span', { className: 'elysium-director-grip', title: '拖动排序', 'aria-hidden': true }, '⋮⋮'), h('h2', null, item.display_name),
            h('div', { className: 'elysium-director-actions' }, h(IconButton, { name: 'edit', label: `编辑导演 ${item.display_name}`, disabled: busy, onClick: () => edit(item) }),
              h(IconButton, { name: 'minus', label: `删除导演 ${item.display_name}`, disabled: busy, onClick: () => { if (window.confirm(`删除导演“${item.display_name}”？`)) run(async () => { await deleteDirector(item.name); await refresh() }) } }))),
          h('p', { className: 'elysium-director-style' }, item.description))))
    )
  }
  Object.assign(exports, { DirectorList })
  return exports
} })
