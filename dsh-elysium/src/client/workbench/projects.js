// 职责：编排项目列表与详情页，将锚点、分镜和交付视图组合为项目工作流。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { Editor } = require('elysium/dialog')
  const { relativeTime } = require('elysium/materials')
  const { fetchProject, fetchProjects, createProject, deleteProject, updateProject } = require('elysium/project-api')
  const { AnchorView } = require('elysium/anchors')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const profiles = { preview: '预览', regular: '常规', 'high-quality': '高清' }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard, navigate = action => action() }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; setBusy(true); setError(''); setSaved(false)
      try { setProject(await action()); setSaved(true); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const activeTab = tab || (project?.acts.some(act => act.shots.length) ? 'acts' : 'anchors')
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h('button', { disabled: busy, onClick: () => navigate(back) }, '返回项目'),
        h('h1', null, project?.title || '项目'), project ? h('button', { disabled: busy, onClick: () => setEditing(true) }, '修改标题') : null,
        h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(x => x + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-content' },
        h('div', { role: 'tablist', 'aria-label': '项目页面' }, [['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '交付']].map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': activeTab === value, disabled: busy, onClick: () => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) }) }, label))),
        activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard }) : activeTab === 'acts' ? h(StoryboardView, { project, save, busy, guard, viewState: viewState.projects?.[id], onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) }) : h(DeliveryView, { project })) : h('p', { role: 'status' }, '加载中…'),
      editing ? h(Editor, { title: '修改项目标题', initial: { title: project.title }, fields: [['title', '项目标题']], guard, close: () => setEditing(false), save }) : null)
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
    const setSelected = selected => { setSelectedLocal(selected); onViewState({ selected, ...(selected !== viewState.selected ? { projectTab: null } : {}) }) }
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true; if (!selected) { setBusy(true); fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }) } return () => { active = false } }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, back: () => setSelected(null) })
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('h1', null, '项目'), h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索项目', value: query, onChange: e => setQuery(e.target.value) }), h('button', { className: 'elysium-primary', onClick: () => setCreating(true) }, '新建项目')),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !items.length && !error ? h('p', { className: 'elysium-empty' }, '还没有项目，从新建项目开始') : null,
      h('div', { className: 'elysium-project-grid' }, items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item => h('article', { className: 'elysium-material-card', key: item.id },
        item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
        h('h2', null, item.title), h('p', null, `${profiles[item.profile === 'hd' ? 'high-quality' : item.profile] || item.profile} · ${item.anchor_count} 锚点`),
        h('p', null, `${item.completed_count}/${item.shot_count} 镜完成 · ${relativeTime(item.updated_at)}`),
        h('button', { className: 'elysium-primary', onClick: () => setSelected(item.id), disabled: busy, 'aria-label': `继续制作 ${item.title}` }, '继续制作'),
        h('details', null, h('summary', null, '更多操作'), h('button', { disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }, '删除项目'))))),
      creating ? h(Editor, { title: '新建项目', initial: { title: '', profile: 'preview' }, fields: [['title', '新项目标题'], ['profile', '项目档次', Object.entries(profiles)]], guard, close: () => setCreating(false), save: async draft => {
        const success = await run(async () => { const project = await createProject(draft.title, draft.profile); setSelected(project.id) }); return success
      } }) : null)
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
