// 职责：列出导演 Skill，并按风格、剧本和分镜编辑对应 Markdown 文件。
window.__ModuleLoader__.load({ id: 'elysium/directors', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { fetchDirectors, fetchDirector, createDirector, saveDirector, reorderDirectors, deleteDirector } = require('elysium/director-api')
  const tabs = [{ id: 'style', label: '导演风格', files: [['SKILL.md', 'SKILL.md 全文']] },
    { id: 'script', label: '导演剧本', files: [['script.md', '剧本要求']] },
    { id: 'storyboard', label: '导演分镜', files: [['storyboard.md', '分镜要求'], ['shot-prompt-example.md', '提示词范例']] }]
  const templates = { 'script.md': '# 导演剧本\n\n## 叙事节奏\n\n## 单集结构与钩子\n',
    'storyboard.md': '# 导演分镜\n\n## 镜头语言\n\n## 提示词额外要求\n', 'shot-prompt-example.md': '# 单镜提示词范例\n' }

  function DirectorList() {
    const [items, setItems] = useState([]), [creating, setCreating] = useState(false), [displayName, setDisplayName] = useState('')
    const [editing, setEditing] = useState(null), [drafts, setDrafts] = useState({}), [saved, setSaved] = useState({}), [tab, setTab] = useState('style'), [dragging, setDragging] = useState(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchDirectors())
    useEffect(() => { let active = true; setBusy(true); fetchDirectors().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    function open(item) {
      const files = item.files || { 'SKILL.md': item.content }
      setEditing(item.name); setDrafts(Object.fromEntries(Object.entries(files).map(([file, value]) => [file, value || templates[file] || ''])))
      setSaved({ ...files }); setTab('style'); setCreating(false)
    }
    async function create(event) {
      event.preventDefault()
      if (!displayName.trim()) return
      await run(async () => {
        const item = await createDirector({ display_name: displayName.trim() })
        await refresh(); setDisplayName(''); open(item)
      })
    }
    async function edit(item) {
      await run(async () => open(await fetchDirector(item.name)))
    }
    async function save(file) {
      if (await run(async () => { await saveDirector({ name: editing, file, content: drafts[file] }); await refresh() })) setSaved(value => ({ ...value, [file]: drafts[file] }))
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
        h(IconButton, { name: creating || editing ? 'close' : 'plus', label: creating || editing ? '取消编辑导演' : '添加导演', disabled: busy, onClick: () => { setCreating(!creating && !editing); setEditing(null); setDisplayName(''); setError('') } })),
      creating ? h('form', { className: 'elysium-director-create', onSubmit: create },
        h('input', { autoFocus: true, 'aria-label': '导演显示名', placeholder: '导演名称', value: displayName, disabled: busy, onChange: event => setDisplayName(event.target.value) }),
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !displayName.trim() }, '创建')) : null,
      editing ? h('section', { className: 'elysium-director-create' },
        h('h2', null, items.find(item => item.name === editing)?.display_name || editing),
        h('nav', { 'aria-label': '导演配置页签' }, tabs.map(item => h('button', { key: item.id, type: 'button', 'aria-selected': tab === item.id,
          onClick: () => setTab(item.id) }, item.label, item.files.some(([file]) => drafts[file] !== saved[file]) ? '（未保存）' : ''))),
        tabs.find(item => item.id === tab)?.files.map(([file, label]) => h('div', { key: file, className: 'elysium-director-editor' },
          h('label', null, label, drafts[file] !== saved[file] ? '（未保存）' : ''),
          h('textarea', { 'aria-label': label, value: drafts[file] || '', disabled: busy, rows: 12,
            onChange: event => setDrafts(value => ({ ...value, [file]: event.target.value })) }),
          h('footer', null, h('button', { className: 'elysium-primary', type: 'button', disabled: busy || drafts[file] === saved[file],
            onClick: () => save(file) }, busy ? '保存中…' : `保存${label}`))))) : null,
      error ? h('p', { role: 'alert' }, error, !items.length ? h('button', { onClick: () => run(refresh) }, '重试') : null) : null,
      busy && !items.length ? h('p', { role: 'status' }, '正在读取导演…') : null,
      !busy && !error && !items.length ? h('p', { className: 'elysium-empty' }, '暂无导演') : null,
      h('div', { className: 'elysium-director-list' }, items.map(item =>
        h('article', { className: 'elysium-director-card', key: item.name, draggable: !busy, 'data-dragging': dragging === item.name || undefined, onDragStart: event => { event.dataTransfer.effectAllowed = 'move'; setDragging(item.name) }, onDragOver: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, onDrop: event => drop(item.name, event), onDragEnd: () => setDragging(null) },
          h('header', { className: 'elysium-director-card-heading' }, h('span', { className: 'elysium-director-grip', title: '拖动排序', 'aria-hidden': true }, '⋮⋮'), h('h2', null, item.display_name),
            h('div', { className: 'elysium-director-actions' }, h(IconButton, { name: 'edit', label: `编辑导演 ${item.display_name}`, disabled: busy, onClick: () => edit(item) }),
              h(IconButton, { name: 'minus', label: `删除导演 ${item.display_name}`, disabled: busy, onClick: () => { if (window.confirm(`删除导演“${item.display_name}”？`)) run(async () => { await deleteDirector(item.name); await refresh() }) } }))))))
    )
  }
  Object.assign(exports, { DirectorList })
  return exports
} })
