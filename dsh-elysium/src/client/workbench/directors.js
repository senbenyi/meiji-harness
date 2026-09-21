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
  const createTemplate = name => `---\nname: director-new\ndescription: ${JSON.stringify((name || '新导演') + '的导演风格')}\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(name || '新导演')}\n  order: 0\n---\n\n# ${name || '新导演'}\n\n## 风格与题材\n\n## 人物塑造\n\n## 声音与对白\n\n## 禁忌\n`

  function DirectorList({ guard }) {
    const [items, setItems] = useState([])
    const [editing, setEditing] = useState(null), [drafts, setDrafts] = useState({}), [saved, setSaved] = useState({}), [tab, setTab] = useState('style'), [styleView, setStyleView] = useState('list'), [newName, setNewName] = useState(''), [newContent, setNewContent] = useState(createTemplate('')), [dragging, setDragging] = useState(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchDirectors())
    useEffect(() => { let active = true; setBusy(true); fetchDirectors().then(async value => {
      if (!active) return
      setItems(value)
      if (value[0]) { const first = await fetchDirector(value[0].name); if (active) open(first) }
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    function open(item) {
      const files = item.files || { 'SKILL.md': item.content }
      const values = Object.fromEntries(Object.entries(files).map(([file, value]) => [file, value || templates[file] || '']))
      setEditing(item.name); setDrafts(values); setSaved(values)
    }
    const dirty = Object.keys(drafts).some(file => drafts[file] !== saved[file])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的导演内容？')) next() }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    async function edit(item, view = styleView) {
      if (item.name !== editing && dirty && !window.confirm('放弃未保存的导演内容？')) return false
      if (item.name === editing) { setStyleView(view); return true }
      return run(async () => { open(await fetchDirector(item.name)); setStyleView(view) })
    }
    async function create(event) {
      event.preventDefault()
      if (!newName.trim()) return
      await run(async () => { await createDirector({ display_name: newName.trim(), content: newContent }); await refresh(); setNewName(''); setNewContent(createTemplate('')); setStyleView('list') })
    }
    async function remove(item) {
      if (!window.confirm(`删除导演“${item.display_name}”？`)) return
      await run(async () => {
        await deleteDirector(item.name)
        const remaining = await fetchDirectors()
        setItems(remaining)
        if (editing === item.name) {
          if (remaining[0]) open(await fetchDirector(remaining[0].name))
          else { setEditing(null); setDrafts({}); setSaved({}) }
        }
      })
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
      h('nav', { 'aria-label': '导演配置页签', role: 'tablist', className: 'elysium-tabs elysium-director-tabs' }, tabs.map(item => h('button', { key: item.id,
        type: 'button', role: 'tab', 'aria-selected': tab === item.id, onClick: () => { setTab(item.id); if (item.id === 'style') setStyleView('list') } },
        item.label, item.files.some(([file]) => drafts[file] !== saved[file]) ? '（未保存）' : ''))),
      tab !== 'style' && items.length ? h('label', { className: 'elysium-director-picker' }, '导演', h('select', { 'aria-label': '选择导演', value: editing || items[0].name,
        disabled: busy, onChange: event => edit(items.find(item => item.name === event.target.value)) }, items.map(item => h('option', { key: item.name, value: item.name }, item.display_name)))) : null,
      editing && (tab !== 'style' || styleView === 'edit') ? h('section', { className: 'elysium-director-create' },
        tab === 'style' ? h('header', null, h('h2', null, items.find(item => item.name === editing)?.display_name || editing),
          h('button', { type: 'button', onClick: () => setStyleView('list') }, '返回')) : null,
        tabs.find(item => item.id === tab)?.files.map(([file, label]) => h('div', { key: file, className: 'elysium-director-editor' },
          h('label', null, label, drafts[file] !== saved[file] ? '（未保存）' : ''),
          h('textarea', { 'aria-label': label, value: drafts[file] || '', disabled: busy, rows: 12,
            onChange: event => setDrafts(value => ({ ...value, [file]: event.target.value })) }),
          h('footer', null, h('button', { className: 'elysium-primary', type: 'button', disabled: busy || drafts[file] === saved[file],
            onClick: () => save(file) }, '保存'))))) : null,
      error ? h('p', { role: 'alert' }, error, !items.length ? h('button', { onClick: () => run(refresh) }, '重试') : null) : null,
      busy && !items.length ? h('p', { role: 'status' }, '正在读取导演…') : null,
      !busy && !error && !items.length && styleView === 'list' && tab === 'style' ? h('p', { className: 'elysium-empty' }, '暂无导演') : null,
      tab === 'style' && styleView === 'create' ? h('form', { className: 'elysium-director-create', onSubmit: create },
        h('label', null, '导演名称', h('input', { autoFocus: true, 'aria-label': '导演名称', value: newName, disabled: busy, onChange: event => {
          const name = event.target.value
          if (newContent === createTemplate(newName)) setNewContent(createTemplate(name.trim()))
          setNewName(name)
        } })),
        h('label', null, 'SKILL.md 全文', h('textarea', { 'aria-label': 'SKILL.md 全文', value: newContent, disabled: busy, rows: 12, onChange: event => setNewContent(event.target.value) })),
        h('footer', null, h('button', { type: 'button', onClick: () => setStyleView('list') }, '取消'),
          h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !newName.trim() || !newContent.trim() }, '保存'))) : null,
      tab === 'style' && styleView === 'list' ? h('div', { className: 'elysium-director-list' },
        h('div', { className: 'elysium-director-toolbar' }, h('button', { type: 'button', className: 'elysium-primary', 'aria-label': '添加导演', disabled: busy, onClick: () => setStyleView('create') }, '＋ 添加导演')), items.map(item =>
        h('article', { className: 'elysium-director-card', key: item.name, draggable: !busy, 'data-dragging': dragging === item.name || undefined, onDragStart: event => { event.dataTransfer.effectAllowed = 'move'; setDragging(item.name) }, onDragOver: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, onDrop: event => drop(item.name, event), onDragEnd: () => setDragging(null) },
          h('header', { className: 'elysium-director-card-heading' }, h('span', { className: 'elysium-director-grip', title: '拖动排序', 'aria-hidden': true }, '⋮⋮'), h('h2', null, item.display_name),
            h('div', { className: 'elysium-director-actions' }, h(IconButton, { name: 'edit', label: `编辑导演 ${item.display_name}`, disabled: busy, onClick: () => edit(item, 'edit') }),
              h(IconButton, { name: 'minus', label: `删除导演 ${item.display_name}`, className: 'elysium-danger', disabled: busy, onClick: () => remove(item) })))))) : null
    )
  }
  Object.assign(exports, { DirectorList })
  return exports
} })
