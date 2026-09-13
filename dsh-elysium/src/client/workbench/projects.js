// 职责：用项目、锚点、分镜、成品四步流程编排项目创建、列表与详情。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { fetchProject, fetchProjects, createProject, deleteProject, updateProject } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const { AnchorView } = require('elysium/anchors')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const profiles = [['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]
  const steps = [['project', '项目'], ['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '成品']]
  const statuses = [['todo', '待处理'], ['active', '进行中'], ['completed', '已完成']]

  const shotsOf = project => project?.acts.flatMap(act => act.shots) || []
  const stageOf = project => {
    const shots = shotsOf(project)
    if (shots.length) return shots.some(shot => shot.status !== 'succeeded') ? 'acts' : 'deliverables'
    return project?.anchors.length ? 'acts' : 'anchors'
  }
  function ProjectSteps({ active, project, navigate, creating = false }) {
    const shots = shotsOf(project)
    const complete = { project: Boolean(project), anchors: Boolean(project?.anchors.length), acts: Boolean(shots.length) && shots.every(shot => shot.status === 'succeeded'), deliverables: Boolean(project?.deliverables.length) }
    return h('nav', { className: 'elysium-project-steps', 'aria-label': '制作流程' }, steps.map(([value, label], index) => h('button', {
      key: value, type: 'button', disabled: creating && value !== 'project', 'aria-label': label, 'aria-current': active === value ? 'step' : undefined,
      'data-complete': complete[value] || undefined, onClick: () => navigate(value),
    }, h('span', { 'aria-hidden': true }, complete[value] ? '✓' : index + 1), h('b', null, label))))
  }
  function ProjectForm({ initial, busy, submit, cancel, action, onDirectorChange }) {
    const [draft, setDraft] = useState(initial)
    const [directors, setDirectors] = useState([]), [directorError, setDirectorError] = useState('')
    useEffect(() => { let active = true; fetchDirectors().then(value => { if (active) setDirectors(value) }).catch(error => { if (active) setDirectorError(error.message) }); return () => { active = false } }, [])
    const save = async event => { event.preventDefault(); if (draft.title.trim() && draft.director) await submit(draft) }
    return h('form', { className: 'elysium-project-form', onSubmit: save },
      h('label', { className: 'elysium-field' }, h('span', null, '项目名称'), h('input', { autoFocus: true, 'aria-label': '项目名称', value: draft.title, disabled: busy, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '项目导演'), h('select', { 'aria-label': '项目导演', value: draft.director, disabled: busy, required: true, onChange: event => { const director = event.target.value; setDraft({ ...draft, director }); return onDirectorChange?.(director) } }, h('option', { value: '' }, '选导演'), directors.map(item => h('option', { key: item.name, value: item.name }, item.name)))),
      directorError ? h('p', { role: 'alert' }, directorError) : null,
      h('label', { className: 'elysium-field' }, h('span', null, '项目档次'), h('select', { 'aria-label': '项目档次', value: draft.profile, disabled: busy, onChange: event => setDraft({ ...draft, profile: event.target.value }) }, profiles.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('footer', null, cancel ? h(IconButton, { name: 'back', label: '返回项目列表', disabled: busy, onClick: cancel }) : null,
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.title.trim() || !draft.director }, busy ? '保存中…' : action)))
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard, navigate = action => action() }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false)
    const go = value => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) })
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) { setProject(value); setTab(current => current || stageOf(value)) } }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; setBusy(true); setError(''); setSaved(false)
      try { setProject(await action()); setSaved(true); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const activeTab = tab || stageOf(project)
    const shots = shotsOf(project)
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h(IconButton, { name: 'back', label: '返回项目', disabled: busy, onClick: () => navigate(back) }), h('h1', null, project?.title || '项目'), h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      project ? h('p', { className: 'elysium-compact-meta' }, `${project.director || '导演未指定'} · ${profiles.find(([value]) => value === project.profile)?.[1] || project.profile} · ${project.anchors.length} 锚点 · ${project.acts.length} 幕 · ${shots.filter(shot => shot.status === 'succeeded').length}/${shots.length} 镜完成 · ${project.deliverables.length} 份交付`) : null,
      h(ProjectSteps, { active: activeTab, project, navigate: go }),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-stage' },
        activeTab === 'project' ? h(ProjectForm, { key: project.updated_at, initial: { title: project.title, director: project.director || '', profile: project.profile === 'hd' ? 'high-quality' : project.profile }, busy, action: '下一步', onDirectorChange: director => save({ director }), submit: async draft => { if (await save(draft)) go('anchors') } })
          : activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard })
            : activeTab === 'acts' ? h(StoryboardView, { project, save, busy, guard, viewState: viewState.projects?.[id], onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) })
              : h(DeliveryView, { project }),
        activeTab === 'anchors' ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !project.anchors.length, onClick: () => go('acts') }, '继续到分镜')) : null,
        activeTab === 'acts' ? h('footer', { className: 'elysium-flow-next' }, h('button', { className: 'elysium-primary', disabled: busy || !shots.length, onClick: () => go('deliverables') }, '继续到成品')) : null) : h('p', { role: 'status' }, '加载中…'))
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [statusTab, setStatusTab] = useState('todo')
    const selectProject = (id, projectTab = null) => { setSelectedLocal(id); onViewState({ selected: id, projectTab }) }
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true; if (!selected) { setBusy(true); fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }) } return () => { active = false } }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, back: () => selectProject(null) })
    if (creating) return h('div', { className: 'elysium-project-setup' },
      h(ProjectSteps, { active: 'project', project: null, creating: true, navigate: () => {} }),
      error ? h('p', { role: 'alert' }, error) : null,
      h(ProjectForm, { initial: { title: '', director: '', profile: 'preview' }, busy, action: '下一步', cancel: () => setCreating(false), submit: draft => run(async () => { const project = await createProject(draft.title, draft.profile, draft.director); setCreating(false); selectProject(project.id, 'anchors') }) }))
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
              h('p', { className: 'elysium-compact-meta' }, `${item.director || '导演未指定'} · ${profiles.find(([value]) => value === item.profile)?.[1] || item.profile} · ${item.completed_count}/${item.shot_count} 镜 · ${progress(item)}`)),
            h('div', { className: 'elysium-card-actions' },
              h(IconButton, { name: 'minus', label: `删除项目 ${item.title}`, disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }))))) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
