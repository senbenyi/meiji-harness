// 职责：编排短剧立项、大纲、人物场景和剧集工作台。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
  const { Dialog, IconButton } = require('elysium/dialog')
  const { fetchProject, fetchProjects, createProject, deleteProject, updateProject, composeFilm, pollProject } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { MaterialList } = require('elysium/materials')
  const { assetUrl } = require('elysium/media-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const { AnchorView } = require('elysium/anchors')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const { PlanningView, EpisodePlanningView } = require('elysium/planning')
  const steps = [['project', '立项'], ['outline', '大纲'], ['anchors', '人物场景'], ['episodes', '剧集']]
  const statuses = [['todo', '待处理'], ['active', '进行中'], ['completed', '已完成']]

  const shotsOf = project => project?.acts.flatMap(act => act.shots) || []
  const stageOf = project => {
    const shots = shotsOf(project)
    if (shots.length) return 'episodes'
    return project?.anchors.length ? 'anchors' : 'project'
  }
  function ProjectSteps({ active, project, navigate, creating = false }) {
    const shots = shotsOf(project)
    const complete = { project: Boolean(project?.genre && project?.synopsis), outline: false, anchors: Boolean(project?.anchors.length),
      episodes: Boolean(shots.length) && shots.every(shot => shot.status === 'succeeded') }
    return h('nav', { className: 'elysium-project-steps', 'aria-label': '制作流程' }, steps.map(([value, label], index) => h('button', {
      key: value, type: 'button', disabled: creating && value !== 'project', 'aria-label': label, 'aria-current': active === value ? 'step' : undefined,
      'data-complete': complete[value] || undefined, onClick: () => navigate(value),
    }, h('span', { 'aria-hidden': true }, complete[value] ? '✓' : index + 1), h('b', null, label))))
  }
  function ProjectForm({ initial, busy, submit, cancel, action, onDirectorChange, guard, requireCover = false }) {
    const [draft, setDraft] = useState(initial), [selectingCover, setSelectingCover] = useState(false)
    const [directors, setDirectors] = useState([]), [directorError, setDirectorError] = useState('')
    useEffect(() => { let active = true; fetchDirectors().then(value => { if (active) setDirectors(value) }).catch(error => { if (active) setDirectorError(error.message) }); return () => { active = false } }, [])
    const dirty = ['title', 'director', 'cover_job_id', 'genre', 'synopsis'].some(key => draft[key] !== initial[key])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的项目信息？')) next() }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const save = async event => { event.preventDefault(); if (draft.title.trim() && draft.director && (!requireCover || draft.cover_job_id && draft.genre?.trim() && draft.synopsis?.trim())) await submit(draft) }
    return h(Fragment, null, h('form', { className: 'elysium-project-form', onSubmit: save },
      h('label', { className: 'elysium-field' }, h('span', null, '项目名称'), h('input', { autoFocus: true, 'aria-label': '项目名称', value: draft.title, disabled: busy, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '题材'), h('input', { 'aria-label': '题材', value: draft.genre || '', disabled: busy, onChange: event => setDraft({ ...draft, genre: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '故事梗概'), h('textarea', { 'aria-label': '故事梗概', value: draft.synopsis || '', disabled: busy, rows: 4, onChange: event => setDraft({ ...draft, synopsis: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '项目导演'), h('select', { 'aria-label': '项目导演', value: draft.director, disabled: busy, required: true, onChange: event => { const director = event.target.value; setDraft({ ...draft, director }); return onDirectorChange?.(director) } }, h('option', { value: '' }, '选导演'), directors.map(item => h('option', { key: item.name, value: item.name }, item.display_name || item.name)))),
      directorError ? h('p', { role: 'alert' }, directorError) : null,
      h('div', { className: 'elysium-field' }, h('span', null, '项目封面'),
        h('button', { type: 'button', disabled: busy, onClick: () => setSelectingCover(true), 'aria-label': draft.cover_job_id ? '更换封面图片' : '选择封面图片' },
          draft.cover_job_id ? h('div', { className: 'elysium-anchor-thumb' }, h('img', { src: assetUrl('image', draft.cover_job_id), alt: '项目封面' })) : '选择图片')),
      h('footer', null, cancel ? h(IconButton, { name: 'back', label: '返回项目列表', disabled: busy, onClick: cancel }) : null,
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.title.trim() || !draft.director || requireCover && (!draft.cover_job_id || !draft.genre?.trim() || !draft.synopsis?.trim()) }, busy ? '保存中…' : action))),
      selectingCover ? h(Dialog, { title: '选择封面图片', busy, close: () => setSelectingCover(false) },
        h(MaterialList, { imageOnly: true, onSelect: item => { if (!item.has_image) return false; setDraft(current => ({ ...current, cover_job_id: item.job_id })); setSelectingCover(false) } })) : null)
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard: externalGuard, navigate = action => action(), directorItems = [] }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null)
    const [directors, setDirectors] = useState(directorItems)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false), readVersion = useRef(0), localGuard = useRef(null)
    const guard = externalGuard || localGuard
    const [remoteUpdate, setRemoteUpdate] = useState(false)
    const go = value => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) })
    useEffect(() => { if (!directorItems.length) fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) { setProject(value); setTab(current => current === 'deliverables' && !value.deliverables.length ? stageOf(value) : current || stageOf(value)) } }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
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
      try { setProject(await action()); setSaved(true); setRemoteUpdate(false); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const continueToFilm = async () => { if (await run(() => composeFilm(id))) go('episodes') }
    const activeTab = tab || stageOf(project)
    const shots = shotsOf(project)
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h(IconButton, { name: 'back', label: '返回项目', disabled: busy, onClick: () => navigate(back) }), project?.cover_job_id ? h('div', { className: 'elysium-anchor-thumb' }, h('img', { src: assetUrl('image', project.cover_job_id), alt: '项目封面预览' })) : null, h('h1', null, project?.title || '项目'), h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      project ? h('p', { className: 'elysium-compact-meta' }, `${directors.find(item => item.name === project.director)?.display_name || project.director || '导演未指定'} · ${project.anchors.length} 锚点 · ${project.acts.length} 幕 · ${shots.filter(shot => shot.status === 'succeeded').length}/${shots.length} 镜完成 · ${project.deliverables.length} 份交付`) : null,
      remoteUpdate ? h('p', { role: 'status' }, '项目已有新修改。请先保存或取消当前编辑，随后自动刷新。') : null,
      h(ProjectSteps, { active: activeTab, project, navigate: go }),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-stage' },
        activeTab === 'project' ? h(Fragment, null,
          h(ProjectForm, { key: project.updated_at, initial: { title: project.title, director: project.director || '', genre: project.genre || '', synopsis: project.synopsis || '', ...(project.cover_job_id ? { cover_job_id: project.cover_job_id } : {}) }, guard, busy, action: '保存项目信息', onDirectorChange: director => save({ director }), submit: save }),
          h(PlanningView, { projectId: id, step: 'series', title: '立项规划' }))
          : activeTab === 'outline' ? h(PlanningView, { projectId: id, step: 'outline', title: '全剧大纲' })
            : activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard })
              : activeTab === 'acts' ? h(StoryboardView, { project, save, run, busy, guard, viewState: viewState.projects?.[id], onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) })
                : activeTab === 'deliverables' ? h(DeliveryView, { project })
              : h(Fragment, null,
                h(EpisodePlanningView, { projectId: id, viewState: viewState.projects?.[id],
                  onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) }),
                project.deliverables.length ? h(DeliveryView, { project }) : null),
        activeTab === 'anchors' ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !project.anchors.length, onClick: () => go('episodes') }, '继续到剧集')) : null,
        activeTab === 'episodes' && project.acts.length ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !shots.length || shots.some(shot => shot.status !== 'succeeded'), onClick: continueToFilm }, busy ? '正在合成成片…' : '合成成片')) : null) : h('p', { role: 'status' }, '加载中…'))
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [directors, setDirectors] = useState([])
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [statusTab, setStatusTab] = useState('todo')
    const selectProject = (id, projectTab = null) => { setSelectedLocal(id); onViewState({ selected: id, projectTab }) }
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true; if (!selected) { setBusy(true); fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }) } return () => { active = false } }, [selected])
    useEffect(() => { fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, directorItems: directors, back: () => selectProject(null) })
    if (creating) return h('div', { className: 'elysium-project-setup' },
      h(ProjectSteps, { active: 'project', project: null, creating: true, navigate: () => {} }),
      error ? h('p', { role: 'alert' }, error) : null,
      h(ProjectForm, { initial: { title: '', director: '', genre: '', synopsis: '' }, requireCover: true, busy, action: '创建项目', cancel: () => setCreating(false), submit: draft => run(async () => { const project = await createProject(draft.title, draft.director, draft.cover_job_id, draft.genre, draft.synopsis); setCreating(false); selectProject(project.id, 'project') }) }))
    const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
    const visible = filtered.filter(item => (item.status || 'todo') === statusTab)
    const progress = item => item.stage === 'anchors' ? '下一步：添加锚点' : item.stage === 'acts' ? item.shot_count ? `分镜 · ${item.completed_count}/${item.shot_count}` : '下一步：添加分镜' : item.deliverable_count ? `成品 · ${item.deliverable_count}` : '下一步：制作成品'
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索', value: query, onChange: event => setQuery(event.target.value) }), h(IconButton, { name: 'plus', label: '新建项目', onClick: () => setCreating(true) })),
      h('nav', { className: 'elysium-project-status-tabs', 'aria-label': '项目状态' }, statuses.map(([status, label]) => h('button', { key: status, type: 'button', 'aria-selected': statusTab === status, onClick: () => setStatusTab(status) }, h('span', null, label), h('b', null, items.filter(item => (item.status || 'todo') === status).length)))),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !error && !visible.length ? h('p', { className: 'elysium-empty' }, '暂无数据') : null,
      !busy && !error && visible.length ? h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { className: 'elysium-material-card elysium-project-card', key: item.id },
            h('div', { className: 'elysium-project-open', role: 'button', tabIndex: 0, 'aria-label': `打开项目 ${item.title}`, onClick: () => selectProject(item.id, item.stage || null), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectProject(item.id, item.stage || null) } } },
              h('h2', null, item.title),
              item.cover_job_id ? h(ShotPreview, { jobId: item.cover_job_id, imageOnly: true }) : item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
              h('p', { className: 'elysium-compact-meta' }, `${directors.find(director => director.name === item.director)?.display_name || item.director || '导演未指定'} · ${item.completed_count}/${item.shot_count} 镜 · ${progress(item)}`)),
            h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
