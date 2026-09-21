// 职责：编排项目、剧本、锚点、分镜和成片工作台，并提供一键生产面板。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { fetchProject, fetchProjects, createProject, suggestProject, deleteProject, updateProject, pollProject, readPlanning, startAuto, pauseAuto, resumeAuto } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const { AnchorView } = require('elysium/anchors')
  const { AutoGenerateButton, ScriptView, StoryboardStepView, FilmStepView } = require('elysium/planning')
  const steps = [['project', '项目'], ['script', '剧本'], ['anchors', '锚点'], ['storyboard', '分镜'], ['film', '成片']]
  const statuses = [['todo', '待处理'], ['active', '进行中'], ['completed', '已完成']]
  // 暂停位置 → 页签，便于从暂停原因直接跳到需要处理的地方。
  const pauseTabs = { series: 'script', timeline: 'script', storyboard: 'storyboard', 'shot-prompt': 'storyboard', shot: 'storyboard', cascade: 'storyboard', anchor: 'anchors', film: 'film' }

  const shotsOf = project => project?.episodes.flatMap(episode => episode.acts.flatMap(act => act.shots)) || []
  const finalValue = entry => entry?.versions.find(item => item.version === entry.finalized)?.value
  const filmCount = project => project?.episodes.filter(episode => episode.deliverables.some(item => item.type === 'film')).length || 0
  const projectDetails = (synopsis, genre = '') => {
    let body = synopsis?.trim() || ''
    if (!body) return genre ? `# 项目详情\n\n## 题材\n${genre}\n\n## 故事梗概\n` : ''
    if (!body.startsWith('# 项目详情')) body = /^#\s/m.test(body) ? `# 项目详情\n\n${body}` : `# 项目详情\n\n## 故事梗概\n${body}`
    return /^## 题材\s*$/m.test(body) ? body : body.replace('# 项目详情', `# 项目详情\n\n## 题材\n${genre}`)
  }
  const detailGenre = details => details.match(/^## 题材\s*\n([^\n#]+)/m)?.[1].trim() || ''
  const completedSteps = (project, planning) => {
    const series = finalValue(planning?.series)
    return { project: Boolean(project?.genre && project?.synopsis), script: Boolean(series), anchors: Boolean(project?.auto.anchors_confirmed),
      storyboard: Boolean(series && Array.from({ length: series.episode_count }, (_, index) => project?.episodes.find(item => item.number === index + 1))
        .every(episode => episode?.acts.some(act => act.shots.length) && episode.acts.every(act => act.shots.every(shot => shot.status === 'succeeded')))),
      film: Boolean(series && filmCount(project) >= series.episode_count) }
  }
  // 「继续」只看真实依赖：锚点与分镜都只依赖剧情总览，成片需要已有镜头。
  const reachable = (project, planning) => ({ script: Boolean(project?.genre && project?.synopsis), anchors: Boolean(finalValue(planning?.series)),
    storyboard: Boolean(finalValue(planning?.series)), film: shotsOf(project).length > 0 })
  const stageOf = (project, planning) => {
    if (!project?.genre || !project?.synopsis) return 'project'
    if (!finalValue(planning?.series)) return 'script'
    if (!project.auto.anchors_confirmed) return 'anchors'
    return filmCount(project) ? 'film' : 'storyboard'
  }
  // 当前自动生产进度：首个未定稿的规划步骤，其后是镜头与合成。
  function currentWork(project, planning) {
    const series = finalValue(planning?.series)
    if (!series) return ''
    const last = Math.min(project.auto.until_episode ?? series.episode_count, series.episode_count)
    for (let episode = 1; episode <= last; episode++) {
      const current = project.episodes.find(item => item.number === episode), produced = current?.acts.flatMap(act => act.shots) || []
      if (produced.length && produced.every(shot => shot.status === 'succeeded' && shot.job_id)) continue
      const entry = planning.episodes?.[episode] || {}, pending = item => !item?.finalized || item.needs_review
      if (pending(entry.timeline)) return `第 ${episode} 集时间线`
      if (pending(entry.storyboard)) return `第 ${episode} 集分镜`
      const shots = finalValue(entry.storyboard).shots
      const prompts = shots.filter(shot => !pending(entry.prompts?.[shot.id])).length
      if (prompts < shots.length) return `第 ${episode} 集提示词 ${prompts}/${shots.length}`
    }
    if (!project.auto.anchors_confirmed) return '等待确认锚点'
    for (let episode = 1; episode <= last; episode++) {
      const current = project.episodes.find(item => item.number === episode), shots = current ? current.acts.flatMap(act => act.shots) : []
      const done = shots.filter(shot => shot.status === 'succeeded').length
      if (!shots.length || done < shots.length) return `第 ${episode} 集镜头 ${done}/${shots.length}`
      if (!current.deliverables.some(item => item.type === 'film')) return `第 ${episode} 集合成`
    }
    return '已完成'
  }

  function ProductionPanel({ project, planning, busy, run, go }) {
    const series = finalValue(planning?.series), auto = project.auto
    const [until, setUntil] = useState(auto.until_episode ? String(auto.until_episode) : '')
    if (!series) return null
    const range = h('select', { 'aria-label': '生产范围', value: until, disabled: busy, onChange: event => setUntil(event.target.value) },
      h('option', { value: '' }, '全部剧集'), series.episodes.map(item => h('option', { key: item.number, value: String(item.number) }, `到第 ${item.number} 集`)))
    const state = auto.paused ? '已暂停' : auto.enabled ? '生产中' : '未开启'
    return h('section', { className: 'elysium-production', 'aria-label': '自动生产' },
      h('p', { role: 'status' }, `${state} · ${currentWork(project, planning)} · 成片 ${filmCount(project)}/${series.episode_count} 集`),
      auto.paused ? h('p', { role: 'alert' }, auto.paused.reason,
        pauseTabs[auto.paused.step] ? h('button', { type: 'button', onClick: () => go(pauseTabs[auto.paused.step], auto.paused) }, '去处理') : null) : null,
      h('div', { className: 'elysium-card-actions' },
        auto.paused ? h('button', { type: 'button', className: 'elysium-primary', disabled: busy, onClick: () => run(() => resumeAuto(project.id)) }, '继续')
          : auto.enabled ? h('button', { type: 'button', disabled: busy, onClick: () => run(() => pauseAuto(project.id)) }, '暂停')
            : h(Fragment, null, range, h('button', { type: 'button', className: 'elysium-primary', disabled: busy, onClick: () => run(() => startAuto(project.id, until ? Number(until) : null)) }, '一键生产')),
        !auto.anchors_confirmed ? h('button', { type: 'button', disabled: busy, onClick: () => go('anchors') }, '去确认锚点') : null))
  }

  function ProjectSteps({ active, project, planning, navigate, creating = false }) {
    const complete = completedSteps(project, planning)
    const started = { project: Boolean(project), script: Boolean(planning?.series?.versions.length), anchors: Boolean(project?.anchors.length),
      storyboard: Boolean(shotsOf(project).length), film: Boolean(project?.episodes.some(episode => episode.film_task || episode.deliverables.length)) }
    return h('nav', { className: 'elysium-project-steps', 'aria-label': '制作流程' }, steps.map(([value, label], index) => h('button', {
      key: value, type: 'button', disabled: creating && value !== 'project', 'aria-label': label, 'aria-current': active === value ? 'step' : undefined,
      'data-complete': complete[value] || undefined, 'data-progress': !complete[value] && started[value] || undefined, onClick: () => navigate(value),
    }, h('span', { 'aria-hidden': true }, complete[value] ? '✓' : index + 1), h('b', null, label))))
  }
  function ProjectForm({ initial, busy, submit, cancel, action, onDirectorChange, guard }) {
    const [draft, setDraft] = useState(initial), [directors, setDirectors] = useState([])
    const [directorError, setDirectorError] = useState(''), [generateError, setGenerateError] = useState(''), [generating, setGenerating] = useState(false)
    useEffect(() => { let active = true; fetchDirectors().then(value => { if (active) { setDirectors(value); setDraft(current => current.director || !value.length ? current : { ...current, director: value[0].name }) } }).catch(error => { if (active) setDirectorError(error.message) }); return () => { active = false } }, [])
    const dirty = ['title', 'director', 'genre', 'synopsis'].some(key => draft[key] !== initial[key])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的项目信息？')) next() }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const locked = busy || generating
    const genre = detailGenre(draft.synopsis || '')
    const valid = draft.title.trim() && directors.some(item => item.name === draft.director) && genre && genre.length <= 200 && draft.synopsis?.trim()
    const save = async event => { event.preventDefault(); if (valid) await submit({ ...draft, genre, synopsis: projectDetails(draft.synopsis, genre) }) }
    const generate = async () => {
      setGenerating(true); setGenerateError('')
      try { const result = await suggestProject(draft.director); setDraft(current => ({ ...current, ...result, synopsis: projectDetails(result.synopsis, result.genre) })) }
      catch (error) { setGenerateError(error.message) }
      finally { setGenerating(false) }
    }
    return h(Fragment, null, h('form', { className: 'elysium-project-form', onSubmit: save },
      h('div', { className: 'elysium-project-form-heading' }, h('h2', null, action === '创建项目' ? '创建项目' : '项目信息'),
        h(AutoGenerateButton, { busy: generating, disabled: busy || !directors.some(item => item.name === draft.director), onClick: generate })),
      h('label', { className: 'elysium-field' }, h('span', null, '项目导演'), h('select', { autoFocus: true, 'aria-label': '项目导演', value: draft.director, disabled: locked || !directors.length, required: true, onChange: event => { const director = event.target.value; setDraft({ ...draft, director }); return onDirectorChange?.(director) } }, directors.map(item => h('option', { key: item.name, value: item.name }, item.display_name || item.name)))),
      directorError ? h('p', { role: 'alert' }, directorError) : null,
      generateError ? h('p', { role: 'alert' }, generateError) : null,
      h('label', { className: 'elysium-field' }, h('span', null, '项目名称'), h('input', { 'aria-label': '项目名称', value: draft.title, disabled: locked, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '项目详情'), h('textarea', { 'aria-label': '项目详情', value: draft.synopsis || '', disabled: locked, rows: 16, placeholder: '# 项目详情\n\n## 题材\n\n## 故事梗概\n\n## 主角与冲突\n\n## 故事走向', onChange: event => setDraft({ ...draft, synopsis: event.target.value }) })),
      h('footer', null, cancel ? h('button', { type: 'button', disabled: locked, onClick: cancel }, '取消') : null,
        h('button', { className: 'elysium-primary', type: 'submit', disabled: locked || !valid }, busy ? '保存中…' : action))))
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard: externalGuard, navigate = action => action(), directorItems = [] }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null)
    const [planning, setPlanning] = useState(null)
    const [directors, setDirectors] = useState(directorItems)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false), readVersion = useRef(0), localGuard = useRef(null)
    const guard = externalGuard || localGuard
    const [remoteUpdate, setRemoteUpdate] = useState(false)
    const projectState = viewState.projects?.[id] || {}
    const go = (value, location) => navigate(() => {
      setTab(value)
      const focus = location?.episode ? { episode: location.episode, episodeTab: location.step === 'shot-prompt' ? 'shot-prompt' : 'storyboard', ...(location.shot_id ? { shot_id: location.shot_id, storyboard: { selected: location.shot_id } } : {}) } : {}
      onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...projectState, ...focus, tab: value } } })
    })
    useEffect(() => { if (!directorItems.length) fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    useEffect(() => { let active = true; Promise.all([fetchProject(id), readPlanning(id)]).then(([value, plan]) => { if (active) {
      setProject(value); setPlanning(plan); setTab(current => steps.some(([key]) => key === current) ? current : stageOf(value, plan))
    } }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    // 串行轮询；保存或项目切换后丢弃迟到结果，编辑中的草稿保持原样。流水线推进时同步刷新规划。
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
          const [value, plan] = await Promise.all([fetchProject(id), readPlanning(id)])
          if (!active || saving.current || version !== readVersion.current) return
          if (guard.current) { setRemoteUpdate(true); return }
          setProject(value); setPlanning(plan); setRemoteUpdate(false)
        } catch (err) { if (active && !saving.current && version === readVersion.current) setError(err.message) }
        finally { if (active) timer = setTimeout(poll, 4000) }
      }
      timer = setTimeout(poll, 4000)
      return () => { active = false; clearTimeout(timer) }
    }, [id, project?.updated_at, guard])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; readVersion.current++; setBusy(true); setError('')
      try { setProject(await action()); setRemoteUpdate(false); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const activeTab = tab || stageOf(project, planning)
    const shots = shotsOf(project)
    const open = reachable(project, planning)
    const next = { script: 'anchors', anchors: 'storyboard', storyboard: 'film' }[activeTab]
    const refresh = project?.updated_at || 0
    const episodeState = { viewState: projectState, onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: { ...value, tab: activeTab } } }) }
    return h('div', { className: `elysium-project-detail${activeTab === 'script' ? ' elysium-project-script' : ''}` },
      h('div', { className: 'elysium-project-heading' }, h(IconButton, { name: 'back', label: '返回项目', disabled: busy, onClick: () => navigate(back) }), h('h1', null, project?.title || '项目'), busy ? h('span', { role: 'status' }, '保存中…') : null),
      project ? h('p', { className: 'elysium-compact-meta' }, `${directors.find(item => item.name === project.director)?.display_name || project.director || '导演未指定'} · ${project.anchors.filter(anchor => anchor.kind === 'character' && !anchor.retired).length} 角色 · ${shots.filter(shot => shot.status === 'succeeded').length}/${shots.length} 镜完成 · ${filmCount(project)} 集成片`) : null,
      remoteUpdate ? h('p', { role: 'status' }, '项目已有新修改。请先保存或取消当前编辑，随后自动刷新。') : null,
      h(ProjectSteps, { active: activeTab, project, planning, navigate: go }),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-stage' },
        activeTab === 'project' ? h(ProductionPanel, { project, planning, busy, run, go }) : null,
        activeTab === 'project' ? h(ProjectForm, { key: project.updated_at, initial: { title: project.title, director: project.director || '', genre: project.genre || '', synopsis: projectDetails(project.synopsis, project.genre) }, guard, busy, action: '继续到剧本', onDirectorChange: director => save({ director }), submit: async draft => { if (await save(draft)) { guard.current = null; go('script') } } })
          : activeTab === 'script' ? h(ScriptView, { projectId: id, projectDetails: projectDetails(project.synopsis, project.genre), refresh, ...episodeState, guard, onChanged: value => { setPlanning(value); fetchProject(id).then(setProject).catch(err => setError(err.message)) } })
            : activeTab === 'anchors' ? h(AnchorView, { project, run, busy })
              : activeTab === 'storyboard' ? h(StoryboardStepView, { key: `${projectState.episode}-${projectState.shot_id}`, projectId: id, refresh, ...episodeState })
                : h(FilmStepView, { key: projectState.episode, projectId: id, refresh, ...episodeState }),
        next ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !open[next], onClick: () => go(next) }, `继续到${steps.find(([key]) => key === next)[1]}`)) : null) : h('p', { role: 'status' }, '加载中…'))
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
      h(ProjectForm, { initial: { title: '', director: '', genre: '', synopsis: '' }, busy, action: '创建项目', cancel: () => setCreating(false), submit: draft => run(async () => { const project = await createProject(draft); setCreating(false); selectProject(project.id, 'script') }) }))
    const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
    const visible = filtered.filter(item => (item.status || 'todo') === statusTab)
    const progress = item => item.episode_count ? `成片 ${item.film_count}/${item.episode_count} 集` : '下一步：剧情总览'
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索', value: query, onChange: event => setQuery(event.target.value) }), h('button', { type: 'button', className: 'elysium-primary', 'aria-label': '新建项目', onClick: () => setCreating(true) }, '＋ 新建项目')),
      h('nav', { className: 'elysium-tabs elysium-project-status-tabs', role: 'tablist', 'aria-label': '项目状态' }, statuses.map(([status, label]) => h('button', { key: status, type: 'button', role: 'tab', 'aria-selected': statusTab === status, onClick: () => setStatusTab(status) }, h('span', null, label), h('b', null, items.filter(item => (item.status || 'todo') === status).length)))),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !error && !visible.length ? h('p', { className: 'elysium-empty' }, '暂无数据') : null,
      !busy && !error && visible.length ? h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { className: 'elysium-material-card elysium-project-card', key: item.id },
            h('div', { className: 'elysium-project-open', role: 'button', tabIndex: 0, 'aria-label': `打开项目 ${item.title}`, onClick: () => selectProject(item.id, null), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectProject(item.id, null) } } },
              h('h2', null, item.title),
              item.cover_job_id ? h(ShotPreview, { jobId: item.cover_job_id, imageOnly: true }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
              h('p', { className: 'elysium-compact-meta' }, `${directors.find(director => director.name === item.director)?.display_name || item.director || '导演未指定'} · ${item.completed_count}/${item.shot_count} 镜 · ${progress(item)}`)),
            h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, className: 'elysium-danger', disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
