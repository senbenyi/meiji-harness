// 职责：读取并轮询单个项目，把 Scene/Segment 工作台接到右侧详情栏。
window.__ModuleLoader__.load({ id: 'elysium/project-detail', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { fetchProject, pollProject } = require('elysium/project-api')

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard: externalGuard, navigate = action => action(), railToggle = null, hostError = '', hostStatus = '' }) {
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
      ? h(require('elysium/project-generation').ProjectWorkflow, { project, busy, run, guard, error: error || hostError, railToggle,
        notice: hostStatus || (remoteUpdate ? '项目已有新修改，请先保存或取消编辑。' : saved ? '已保存' : ''), back: () => navigate(back),
        viewState: viewState.projects?.[id]?.navigation,
        onViewState: navigation => onViewState({ projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], navigation } } }) })
      : h('div', { className: 'elysium-series-empty' }, railToggle ? h('header', { className: 'elysium-app-navbar' }, h('h1', null, '项目详情'), railToggle) : (back ? h('button', { onClick: back }, '返回项目列表') : null), hostError || error ? h('p', { role: 'alert' }, hostError || error, h('button', { onClick: () => { setError(''); setReload(value => value + 1) } }, '重试')) : hostStatus ? h('p', { role: 'status' }, hostStatus) : h('p', { role: 'status' }, '加载中…')))
  }
  Object.assign(exports, { ProjectDetail })
  return exports
} })
