// 职责：编排项目、剧本、锚点、分镜和成片工作台。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
  const { Dialog, IconButton } = require('elysium/dialog')
  const { fetchProject, fetchProjects, createProject, deleteProject, updateProject, pollProject, readPlanning } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { MaterialList } = require('elysium/materials')
  const { assetUrl } = require('elysium/media-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const { AnchorView } = require('elysium/anchors')
  const { ScriptView, StoryboardStepView, FilmStepView } = require('elysium/planning')
  const steps = [['project', '项目'], ['script', '剧本'], ['anchors', '锚点'], ['storyboard', '分镜'], ['film', '成片']]
  const statuses = [['todo', '待处理'], ['active', '进行中'], ['completed', '已完成']]

  const shotsOf = project => project?.episodes?.length ? project.episodes.flatMap(episode => episode.acts.flatMap(act => act.shots))
    : project?.acts.flatMap(act => act.shots) || []
  const finalValue = entry => entry?.versions.find(item => item.version === entry.finalized)?.value
  const completedSteps = (project, planning) => {
    const series = finalValue(planning?.series), shots = shotsOf(project)
    const scripts = Boolean(series && Array.from({ length: series.episode_count }, (_, index) => planning.episodes?.[index + 1]?.timeline).every(entry => entry?.finalized && !entry.needs_review))
    const anchors = Boolean(series && series.characters.every(character => {
      const anchor = project?.anchors.find(item => item.role === character.id)
      return anchor && !anchor.retired && !anchor.image_needs_review && (anchor.source?.job_id || anchor.image_url)
    }))
    const film = Boolean(series && Array.from({ length: series.episode_count }, (_, index) => project?.episodes?.find(item => item.number === index + 1)?.deliverables.some(item => item.type === 'film')).every(Boolean))
    return { project: Boolean(project?.genre && project?.synopsis), script: scripts, anchors,
      storyboard: Boolean(shots.length && shots.every(shot => shot.accepted)), film }
  }
  const stageOf = (project, planning) => {
    const shots = shotsOf(project)
    if (!project?.genre || !project?.synopsis) return 'project'
    if (!finalValue(planning?.series)) return 'script'
    if (!project?.anchors.length) return 'anchors'
    return shots.length && shots.every(shot => shot.accepted) ? 'film' : 'storyboard'
  }
  function ProjectSteps({ active, project, planning, navigate, creating = false }) {
    const complete = completedSteps(project, planning)
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
      h('footer', null, cancel ? h('button', { type: 'button', disabled: busy, onClick: cancel }, '取消') : null,
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.title.trim() || !draft.director || requireCover && (!draft.cover_job_id || !draft.genre?.trim() || !draft.synopsis?.trim()) }, busy ? '保存中…' : action))),
      selectingCover ? h(Dialog, { title: '选择封面图片', busy, close: () => setSelectingCover(false) },
        h(MaterialList, { imageOnly: true, onSelect: item => { if (!item.has_image) return false; setDraft(current => ({ ...current, cover_job_id: item.job_id })); setSelectingCover(false) } })) : null)
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard: externalGuard, navigate = action => action(), directorItems = [] }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null)
    const [planning, setPlanning] = useState(null)
    const [directors, setDirectors] = useState(directorItems)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false), readVersion = useRef(0), localGuard = useRef(null)
    const guard = externalGuard || localGuard
    const [remoteUpdate, setRemoteUpdate] = useState(false)
    const go = value => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) })
    useEffect(() => { if (!directorItems.length) fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    useEffect(() => { let active = true; Promise.all([fetchProject(id), readPlanning(id)]).then(([value, plan]) => { if (active) {
      setProject(value); setPlanning(plan); setTab(current => steps.some(([key]) => key === current) ? current : stageOf(value, plan))
    } }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
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
    const activeTab = tab || stageOf(project, planning)
    const shots = shotsOf(project)
    const complete = completedSteps(project, planning)
    const next = { project: 'script', script: 'anchors', anchors: 'storyboard', storyboard: 'film' }[activeTab]
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h(IconButton, { name: 'back', label: '返回项目', disabled: busy, onClick: () => navigate(back) }), project?.cover_job_id ? h('div', { className: 'elysium-anchor-thumb' }, h('img', { src: assetUrl('image', project.cover_job_id), alt: '项目封面预览' })) : null, h('h1', null, project?.title || '项目'), h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      project ? h('p', { className: 'elysium-compact-meta' }, `${directors.find(item => item.name === project.director)?.display_name || project.director || '导演未指定'} · ${project.anchors.length} 锚点 · ${project.episodes?.length || 0} 集 · ${shots.filter(shot => shot.status === 'succeeded').length}/${shots.length} 镜完成 · ${project.episodes?.flatMap(episode => episode.deliverables).length || project.deliverables.length} 份交付`) : null,
      remoteUpdate ? h('p', { role: 'status' }, '项目已有新修改。请先保存或取消当前编辑，随后自动刷新。') : null,
      h(ProjectSteps, { active: activeTab, project, planning, navigate: go }),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-stage' },
        activeTab === 'project' ? h(Fragment, null,
          h(ProjectForm, { key: project.updated_at, initial: { title: project.title, director: project.director || '', genre: project.genre || '', synopsis: project.synopsis || '', ...(project.cover_job_id ? { cover_job_id: project.cover_job_id } : {}) }, guard, busy, action: '保存', onDirectorChange: director => save({ director }), submit: save }))
          : activeTab === 'script' ? h(ScriptView, { projectId: id, onChanged: value => { setPlanning(value); fetchProject(id).then(setProject).catch(err => setError(err.message)) } })
            : activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard })
              : activeTab === 'storyboard' ? h(StoryboardStepView, { projectId: id, viewState: viewState.projects?.[id],
                onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) })
                : h(FilmStepView, { projectId: id, viewState: viewState.projects?.[id],
                  onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) }),
        next ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !complete[activeTab], onClick: () => go(next) }, `继续到${steps.find(([key]) => key === next)[1]}`)) : null,
        null) : h('p', { role: 'status' }, '加载中…'))
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
    const progress = item => item.stage === 'project' ? '下一步：项目' : item.stage === 'anchors' ? '下一步：锚点' : item.shot_count ? `分镜 · ${item.completed_count}/${item.shot_count}` : '下一步：剧本'
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索', value: query, onChange: event => setQuery(event.target.value) }), h('button', { type: 'button', className: 'elysium-primary', 'aria-label': '新建项目', onClick: () => setCreating(true) }, '＋ 新建项目')),
      h('nav', { className: 'elysium-tabs elysium-project-status-tabs', role: 'tablist', 'aria-label': '项目状态' }, statuses.map(([status, label]) => h('button', { key: status, type: 'button', role: 'tab', 'aria-selected': statusTab === status, onClick: () => setStatusTab(status) }, h('span', null, label), h('b', null, items.filter(item => (item.status || 'todo') === status).length)))),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !error && !visible.length ? h('p', { className: 'elysium-empty' }, '暂无数据') : null,
      !busy && !error && visible.length ? h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { className: 'elysium-material-card elysium-project-card', key: item.id },
            h('div', { className: 'elysium-project-open', role: 'button', tabIndex: 0, 'aria-label': `打开项目 ${item.title}`, onClick: () => selectProject(item.id, null), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectProject(item.id, null) } } },
              h('h2', null, item.title),
              item.cover_job_id ? h(ShotPreview, { jobId: item.cover_job_id, imageOnly: true }) : item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
              h('p', { className: 'elysium-compact-meta' }, `${directors.find(director => director.name === item.director)?.display_name || item.director || '导演未指定'} · ${item.completed_count}/${item.shot_count} 镜 · ${progress(item)}`)),
            h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, className: 'elysium-danger', disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
