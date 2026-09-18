// 职责：编排项目列表、创建入口与剧集工作台，统一项目读取和轮询。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
  const { Dialog, IconButton } = require('elysium/dialog')
  const { fetchProject, fetchProjects, createProject, deleteProject, updateProject, pollProject } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { MaterialList } = require('elysium/materials')
  const { assetUrl } = require('elysium/media-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const profiles = [['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]
  const statuses = [['all', '全部'], ['todo', '待处理'], ['active', '进行中'], ['completed', '已完成']]

  function ProjectForm({ initial, busy, submit, cancel, action, onDirectorChange, guard, requireCover = false }) {
    const [draft, setDraft] = useState(initial), [selectingCover, setSelectingCover] = useState(false)
    const [directors, setDirectors] = useState([]), [directorError, setDirectorError] = useState('')
    useEffect(() => { let active = true; fetchDirectors().then(value => { if (active) setDirectors(value) }).catch(error => { if (active) setDirectorError(error.message) }); return () => { active = false } }, [])
    const dirty = ['title', 'director', 'profile', 'cover_job_id'].some(key => draft[key] !== initial[key])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的项目信息？')) next() }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const save = async event => { event.preventDefault(); if (draft.title.trim() && (!requireCover || draft.cover_job_id)) await submit(draft) }
    return h(Fragment, null, h('form', { className: 'elysium-project-form', onSubmit: save },
      h('label', { className: 'elysium-field' }, h('span', null, '项目名称'), h('input', { autoFocus: true, 'aria-label': '项目名称', value: draft.title, disabled: busy, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '项目导演'), h('select', { 'aria-label': '项目导演', value: draft.director, disabled: busy, required: false, onChange: event => { const director = event.target.value; setDraft({ ...draft, director }); return onDirectorChange?.(director) } }, h('option', { value: '' }, '选导演'), directors.map(item => h('option', { key: item.name, value: item.name }, item.name)))),
      directorError ? h('p', { role: 'alert' }, directorError) : null,
      h('label', { className: 'elysium-field' }, h('span', null, '项目档次'), h('select', { 'aria-label': '项目档次', value: draft.profile, disabled: busy, onChange: event => setDraft({ ...draft, profile: event.target.value }) }, profiles.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('div', { className: 'elysium-field' }, h('span', null, '项目封面'),
        h('button', { type: 'button', disabled: busy, onClick: () => setSelectingCover(true), 'aria-label': draft.cover_job_id ? '更换封面图片' : '选择封面图片' },
          draft.cover_job_id ? h('div', { className: 'elysium-anchor-thumb' }, h('img', { src: assetUrl('image', draft.cover_job_id), alt: '项目封面' })) : '选择图片')),
      h('footer', null, cancel ? h(IconButton, { name: 'back', label: '返回项目列表', disabled: busy, onClick: cancel }) : null,
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.title.trim() || requireCover && !draft.cover_job_id }, busy ? '保存中…' : action))),
      selectingCover ? h(Dialog, { title: '选择封面图片', busy, close: () => setSelectingCover(false) },
        h(MaterialList, { imageOnly: true, onSelect: item => { if (!item.has_image) return false; setDraft(current => ({ ...current, cover_job_id: item.job_id })); setSelectingCover(false) } })) : null)
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard: externalGuard, navigate = action => action() }) {
    const [project, setProject] = useState(null)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false), readVersion = useRef(0), localGuard = useRef(null)
    const guard = externalGuard || localGuard
    const [remoteUpdate, setRemoteUpdate] = useState(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    // 串行轮询；保存或项目切换后丢弃迟到结果，编辑中的草稿保持原样。
    useEffect(() => {
      if (!project) return
      let active = true, timer
      const poll = async () => {
        const version = readVersion.current
        try {
          if (saving.current) return
          const result = await pollProject(id, project.updated_at || 0)
          if (!active || saving.current || version !== readVersion.current || !result.updated) return
          if (guard.current) { setRemoteUpdate(true); return }
          const value = await fetchProject(id)
          if (!active || saving.current || version !== readVersion.current) return
          if (guard.current) { setRemoteUpdate(true); return }
          setProject(value); setSaved(false); setRemoteUpdate(false)
        } catch (err) { if (active && !saving.current && version === readVersion.current) setError(err.message) }
        finally { if (active) timer = setTimeout(poll, 4000) }
      }
      timer = setTimeout(poll, 4000)
      return () => { active = false; clearTimeout(timer) }
    }, [id, project?.updated_at, guard])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; readVersion.current++; setBusy(true); setError(''); setSaved(false)
      try { setProject(await action()); setSaved(true); setRemoteUpdate(false); return true } catch (err) { setError(err.message); try { setProject(await fetchProject(id)) } catch {} return false } finally { saving.current = false; setBusy(false) }
    }
    return h('div', { className: 'elysium-project-detail' }, project
      ? h(require('elysium/project-generation').ProjectWorkflow, { project, busy, run, guard, error,
        notice: remoteUpdate ? '项目已有新修改，请先保存或取消编辑。' : saved ? '已保存' : '', back: () => navigate(back),
        viewState: viewState.projects?.[id]?.navigation,
        onViewState: navigation => onViewState({ projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], navigation } } }) })
      : h('div', null, h('button', { onClick: back }, '返回项目列表'), error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试')) : h('p', { role: 'status' }, '加载中…')))
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action(), onSelect } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [statusTab, setStatusTab] = useState('all')
    const selectProject = (id, projectTab = null) => navigate(() => { if (onSelect) return onSelect(id); setSelectedLocal(id); onViewState({ selected: id, projectTab }) })
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true, timer; const load = async () => {
      try { const value = await fetchProjects(); if (active) setItems(value) } catch (err) { if (active) setError(err.message) }
      finally { if (active) { setBusy(false); if (onSelect) timer = setTimeout(load, 4000) } }
    }; if (!selected || onSelect) { setBusy(true); load() } return () => { active = false; clearTimeout(timer) } }, [selected, Boolean(onSelect)])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    useEffect(() => { setSelectedLocal(viewState.selected || null); setCreating(false) }, [viewState.selected])
    if (selected && !onSelect) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, back: () => selectProject(null) })
    const createForm = creating ? h(Dialog, { title: '新建项目', busy, close: () => setCreating(false) }, h('div', { className: 'elysium-project-setup' },
      h('header', { className: 'elysium-app-navbar' }, h('button', { onClick: () => navigate(() => setCreating(false)) }, '‹ 项目列表'), h('h1', null, '新建项目')),
      error ? h('p', { role: 'alert' }, error) : null,
      h(ProjectForm, { initial: { title: '', director: '', profile: 'regular' }, requireCover: false, busy, action: '下一步', cancel: () => setCreating(false), submit: draft => run(async () => { const project = await createProject(draft.title, draft.profile, draft.director, draft.cover_job_id); setCreating(false); await refresh(); selectProject(project.id) }) }))) : null
    const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
    const visible = filtered.filter(item => statusTab === 'all' || (item.status || 'todo') === statusTab)
    const progress = item => ({ configuration: '请配置素材', 'plot-generating': '剧情生成中', plot: '请查看剧情', 'storyboard-generating': '分镜生成中', storyboard: '请审核分镜', video: '视频生成中', complete: '成片已完成', failed: '任务待恢复' }[item.stage] || '制作中')
    return h('div', { className: 'elysium-project-home' },
      createForm,
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索', value: query, onChange: event => setQuery(event.target.value) }), h(IconButton, { name: 'plus', label: '新建项目', onClick: () => setCreating(true) })),
      h('nav', { className: 'elysium-project-status-tabs', 'aria-label': '项目状态' }, statuses.map(([status, label]) => h('button', { key: status, type: 'button', 'aria-selected': statusTab === status, onClick: () => setStatusTab(status) }, h('span', null, label), h('b', null, items.filter(item => status === 'all' || (item.status || 'todo') === status).length)))),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !error && !visible.length ? h('p', { className: 'elysium-empty' }, '暂无数据') : null,
      !busy && !error && visible.length ? h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { className: 'elysium-material-card elysium-project-card', 'data-selected': selected === item.id, key: item.id },
            h('div', { className: 'elysium-project-open', role: 'button', tabIndex: 0, 'aria-pressed': selected === item.id, 'aria-label': `打开项目 ${item.title}`, onClick: () => selectProject(item.id, item.stage || null), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectProject(item.id, item.stage || null) } } },
              h('h2', null, item.title),
              item.cover_job_id ? h(ShotPreview, { jobId: item.cover_job_id, imageOnly: true }) : item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
              h('p', { className: 'elysium-compact-meta' }, `${item.director || '导演未指定'} · ${profiles.find(([value]) => value === item.profile)?.[1] || item.profile} · ${item.episode_count || 1} 集 · ${item.completed_count}/${item.shot_count} 镜 · ${progress(item)}`)),
            h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); if (selected === item.id) selectProject(null); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
