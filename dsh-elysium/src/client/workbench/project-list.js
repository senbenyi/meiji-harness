// 职责：展示项目列表、状态筛选、搜索与新建弹窗，不负责项目详情。
window.__ModuleLoader__.load({ id: 'elysium/project-list', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { Dialog, IconButton } = require('elysium/dialog')
  const { fetchProjects, createProject, deleteProject } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { assetUrl } = require('elysium/media-api')
  const statuses = [['active', '进行中'], ['completed', '已完成']]
  const matchesStatus = (item, status) => status === 'completed' ? item.status === 'completed' : item.status !== 'completed'
  const ratios = [['9:16', '9:16 竖屏'], ['16:9', '16:9 横屏']]

  function ProjectForm({ initial, busy, submit, guard }) {
    const [draft, setDraft] = useState(initial)
    const [directors, setDirectors] = useState([]), [directorError, setDirectorError] = useState(''), [scriptError, setScriptError] = useState('')
    useEffect(() => { let active = true; fetchDirectors().then(value => { if (active) setDirectors(value) }).catch(error => { if (active) setDirectorError(error.message) }); return () => { active = false } }, [])
    const dirty = ['title', 'duration_min', 'aspect_ratio', 'director', 'reference_text'].some(key => draft[key] !== initial[key])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的项目信息？')) next() }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const ready = draft.title.trim() && Number.isInteger(Number(draft.duration_min)) && Number(draft.duration_min) >= 1 && Number(draft.duration_min) <= 25
    const save = async event => { event.preventDefault(); if (ready) await submit({ ...draft, duration_min: Number(draft.duration_min) }) }
    const selectedDirector = directors.find(item => item.name === draft.director)
    return h('form', { id: 'elysium-create-project', className: 'elysium-project-form', onSubmit: save },
      h('label', { className: 'elysium-field' }, h('span', null, '标题'), h('input', { autoFocus: true, required: true, 'aria-label': '标题', value: draft.title, disabled: busy, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '总时长（分钟）'), h('input', { type: 'number', min: 1, max: 25, step: 1, required: true, 'aria-label': '总时长', value: draft.duration_min, disabled: busy, onChange: event => setDraft({ ...draft, duration_min: event.target.value }) })),
      h('fieldset', { className: 'elysium-field', disabled: busy }, h('legend', null, '画幅'),
        h('div', { className: 'elysium-ratio-options', role: 'radiogroup', 'aria-label': '画幅' }, ratios.map(([value, label]) => h('button', { key: value, type: 'button', role: 'radio', 'aria-checked': draft.aspect_ratio === value, 'aria-pressed': draft.aspect_ratio === value, onClick: () => setDraft({ ...draft, aspect_ratio: value }) }, label)))),
      h('label', { className: 'elysium-field' }, h('span', null, '风格'), h('select', { 'aria-label': '风格', value: draft.director, disabled: busy, onChange: event => setDraft({ ...draft, director: event.target.value }) }, h('option', { value: '' }, '选择导演风格'), directors.map(item => h('option', { key: item.name, value: item.name }, item.name)))),
      directorError ? h('p', { role: 'alert' }, directorError) : null,
      selectedDirector ? h('p', { className: 'elysium-compact-meta' }, selectedDirector.style) : null,
      h('label', { className: 'elysium-field' }, h('span', null, '剧本'), h('textarea', { 'aria-label': '剧本', rows: 8, value: draft.reference_text, disabled: busy, placeholder: '粘贴剧本，或导入文件', onChange: event => setDraft({ ...draft, reference_text: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '导入剧本文件'), h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', disabled: busy, 'aria-label': '导入剧本', onChange: async event => {
        const file = event.target.files?.[0]
        if (!file) return
        try { const text = await file.text(); if (text.length > 100000) throw new Error('剧本超过 10 万字符，请选择需要改编的章节'); setDraft(current => ({ ...current, reference_text: text })); setScriptError('') } catch (error) { setScriptError(error.message) }
      } })),
      scriptError ? h('p', { role: 'alert' }, scriptError) : null)
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action(), onSelect, collapsed = false } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [statusTab, setStatusTab] = useState('active')
    const selectProject = (id, projectTab = null) => navigate(() => { if (onSelect) return onSelect(id); setSelectedLocal(id); onViewState({ selected: id, projectTab }) })
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true, timer; const load = async () => {
      try { const value = await fetchProjects(); if (active) setItems(value) } catch (err) { if (active) setError(err.message) }
      finally { if (active) { setBusy(false); if (onSelect) timer = setTimeout(load, 4000) } }
    }; setBusy(true); load(); return () => { active = false; clearTimeout(timer) } }, [Boolean(onSelect)])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    useEffect(() => { setSelectedLocal(viewState.selected || null); setCreating(false) }, [viewState.selected])
    const createForm = creating ? h(Dialog, { title: '新建项目', className: 'elysium-create-project-dialog', busy, close: () => setCreating(false),
      footer: h('button', { className: 'elysium-primary', type: 'submit', form: 'elysium-create-project', disabled: busy }, busy ? '创建中…' : '创建') },
      error ? h('p', { role: 'alert' }, error) : null,
      h(ProjectForm, { initial: { title: '', duration_min: '', aspect_ratio: '9:16', director: '', reference_text: '' }, busy, guard, submit: draft => run(async () => {
        const project = await createProject({ title: draft.title, director: draft.director || undefined, duration_min: draft.duration_min, aspect_ratio: draft.aspect_ratio, reference_text: draft.reference_text })
        setCreating(false); await refresh(); selectProject(project.id)
      }) })) : null
    const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
    const visible = filtered.filter(item => matchesStatus(item, statusTab))
    const cover = item => item.cover_job_id
      ? h('img', { className: 'elysium-project-cover', src: assetUrl('image', item.cover_job_id, item.cover_kind === 'video' ? { frame: 'first' } : { preview: 1 }), loading: 'lazy', alt: '' })
      : item.cover_url ? h('img', { className: 'elysium-project-cover', src: item.cover_url, loading: 'lazy', alt: '' }) : h('div', { className: 'elysium-project-cover elysium-project-cover-empty', 'aria-hidden': true })
    return h('div', { className: `elysium-project-home${collapsed ? ' elysium-project-home-collapsed' : ''}` },
      createForm,
      collapsed ? null : h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索', value: query, onChange: event => setQuery(event.target.value) }), h(IconButton, { name: 'plus', label: '新建项目', onClick: () => setCreating(true) })),
      collapsed ? null : h('nav', { className: 'elysium-project-status-tabs', 'aria-label': '项目状态' }, statuses.map(([status, label]) => h('button', { key: status, type: 'button', 'aria-selected': statusTab === status, onClick: () => setStatusTab(status) }, h('span', null, label), h('b', null, items.filter(item => matchesStatus(item, status)).length)))),
      busy && !collapsed ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error && !collapsed ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !error && !visible.length ? h('p', { className: 'elysium-empty' }, collapsed ? '暂无' : '暂无项目') : null,
      !busy && !error && visible.length ? h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { className: 'elysium-project-card', 'data-selected': selected === item.id, key: item.id },
            h('div', { className: 'elysium-project-open', role: 'button', tabIndex: 0, title: item.title, 'aria-pressed': selected === item.id, 'aria-label': `打开项目 ${item.title}`, onClick: () => selectProject(item.id, item.stage || null), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectProject(item.id, item.stage || null) } } },
              collapsed ? null : cover(item),
              h('div', { className: 'elysium-project-body' },
                h('h2', null, item.title),
                collapsed ? null : h('p', { className: 'elysium-project-episodes' }, `${item.episode_count || 1} 集`),
                collapsed ? null : (item.plot_summary ? h('p', { className: 'elysium-project-plot' }, item.plot_summary) : null))),
            collapsed ? null : h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); if (selected === item.id) selectProject(null); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectForm })
  return exports
} })
