// 职责：展示导演库，并在页面内完成导演新增、编辑和删除。
window.__ModuleLoader__.load({ id: 'elysium/directors', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { fetchDirectors, createDirector, updateDirector, reorderDirectors, deleteDirector } = require('elysium/director-api')
  const empty = { name: '', style: '', works: '' }
  const worksValue = value => value.replace(/^\s*1[、.．,，]\s*/, '').split(/\s+[2-5][、.．,，]\s*|\n|、/).map(item => item.trim()).filter(Boolean)

  function DirectorList() {
    const [items, setItems] = useState([]), [adding, setAdding] = useState(false), [editing, setEditing] = useState(null), [draft, setDraft] = useState(empty), [dragging, setDragging] = useState(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchDirectors())
    useEffect(() => { let active = true; setBusy(true); fetchDirectors().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    async function submit(event) {
      event.preventDefault()
      const works = worksValue(draft.works)
      if (await run(async () => { const director = await (editing ? updateDirector : createDirector)({ name: draft.name, style: draft.style, works }); setItems(value => editing ? value.map(item => item.name === editing ? director : item) : [...value, director]) })) { setDraft(empty); setAdding(false); setEditing(null) }
    }
    async function drop(target, event) {
      event.preventDefault()
      const source = dragging
      setDragging(null)
      if (!source || source === target) return
      const previous = items, ordered = items.filter(item => item.name !== source)
      const targetIndex = ordered.findIndex(item => item.name === target)
      const bounds = event.currentTarget.getBoundingClientRect()
      const after = event.clientY > bounds.top + bounds.height / 2
      ordered.splice(targetIndex + (after ? 1 : 0), 0, items.find(item => item.name === source))
      setItems(ordered)
      if (!await run(() => reorderDirectors(ordered.map(item => item.name)))) setItems(previous)
    }
    return h('div', { className: 'elysium-directors' },
      h('div', { className: 'elysium-toolbar' }, h(IconButton, { name: adding || editing ? 'close' : 'plus', label: adding || editing ? '取消编辑导演' : '添加导演', disabled: busy, onClick: () => { setAdding(!adding && !editing); setEditing(null); setDraft(empty); setError('') } })),
      adding || editing ? h('form', { className: 'elysium-director-create', onSubmit: submit },
        h('input', { autoFocus: true, 'aria-label': '导演名称', placeholder: '导演名称', value: draft.name, disabled: busy || !!editing, onChange: event => setDraft({ ...draft, name: event.target.value }) }),
        h('input', { 'aria-label': '导演风格', placeholder: '导演风格', value: draft.style, disabled: busy, onChange: event => setDraft({ ...draft, style: event.target.value }) }),
        h('textarea', { 'aria-label': 'TOP5作品', placeholder: 'TOP5 作品，每行一部', rows: 5, value: draft.works, disabled: busy, onChange: event => setDraft({ ...draft, works: event.target.value }) }),
        h('footer', null, h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.name.trim() || !draft.style.trim() }, busy ? '保存中…' : '保存'))) : null,
      error ? h('p', { role: 'alert' }, error, !items.length ? h('button', { onClick: () => run(refresh) }, '重试') : null) : null,
      busy && !items.length ? h('p', { role: 'status' }, '正在读取导演…') : null,
      h('div', { className: 'elysium-director-list' }, items.map(item =>
        h('article', { className: 'elysium-director-card', key: item.name, draggable: !busy, 'data-dragging': dragging === item.name || undefined, title: '点击编辑，拖动排序', onClick: () => { if (busy) return; setEditing(item.name); setAdding(false); setDraft({ ...item, works: item.works.join('\n') }); setError('') }, onDragStart: event => { event.dataTransfer.effectAllowed = 'move'; setDragging(item.name) }, onDragOver: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, onDrop: event => drop(item.name, event), onDragEnd: () => setDragging(null) },
          h('div', { className: 'elysium-director-copy' }, h('h2', null, item.name), h('p', null, item.style), h('ol', { 'aria-label': `${item.name} TOP5作品` }, item.works.map((work, index) => h('li', { key: `${index}-${work}` }, work)))),
          h(IconButton, { name: 'minus', label: `删除导演 ${item.name}`, disabled: busy, onClick: event => { event.stopPropagation(); if (window.confirm(`删除导演“${item.name}”？`)) run(async () => { await deleteDirector(item.name); setItems(value => value.filter(director => director.name !== item.name)) }) } })))))
  }
  Object.assign(exports, { DirectorList, worksValue })
  return exports
} })
