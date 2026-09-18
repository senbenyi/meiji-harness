// 职责：组合项目列表、关联对话与详情，协调导航、面板尺寸和草稿保护。
window.__ModuleLoader__.load({ id: 'elysium/workbench', factory: require => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { ProjectList, ProjectDetail } = require('elysium/projects')
  const { MaterialList } = require('elysium/materials')
  const { Settings } = require('elysium/settings')
  const generation = require('elysium/project-generation')
  const STORAGE_KEY = 'elysium-workbench'
  function Workbench() {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} } catch {}
      return { leftWidth: saved.leftWidth || 250, rightWidth: saved.rightWidth || 400, activeTab: saved.activeTab === 'servers' ? 'settings' : saved.activeTab === 'directors' ? 'materials' : saved.activeTab || 'projects', selected: saved.selected || null, materials: saved.materials || {}, projects: saved.projects || {} }
    })
    const [viewport, setViewport] = useState(window.innerWidth), [nativeWidth, setNativeWidth] = useState(56)
    const [error, setError] = useState(''), [switching, setSwitching] = useState(false)
    const guard = useRef(null), leftGuard = useRef(null), selecting = useRef(false), selectionVersion = useRef(0), drag = useRef(null)
    const selected = useRef(state.selected); selected.current = state.selected
    const narrow = viewport < 1000
    const available = Math.max(520, viewport - nativeWidth - 300)
    const leftWidth = Math.max(220, Math.min(state.leftWidth, available - 300))
    const rightWidth = Math.max(300, Math.min(state.rightWidth, available - leftWidth))
    const change = patch => setState(value => ({ ...value, ...patch }))
    const navigate = action => {
      const next = () => leftGuard.current ? leftGuard.current(action) : action()
      return guard.current ? guard.current(next) : next()
    }
    const selectProject = async id => {
      if (selecting.current) return
      if (!id) { change({ selected: null }); return }
      selecting.current = true; selectionVersion.current++; setSwitching(true); setError('')
      try { await generation.selectProject(id); change({ selected: id }) }
      catch (err) { setError(err.message) }
      finally { selecting.current = false; setSwitching(false) }
    }
    useEffect(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
    }, [state])
    useEffect(() => {
      if (selected.current) selectProject(selected.current)
      const open = event => navigate(() => { change({ activeTab: 'projects' }); selectProject(event.detail.id) })
      window.addEventListener('elysium:open-project', open)
      const unsubscribe = generation.watchSession(async sessionId => {
        if (selecting.current) return
        const version = ++selectionVersion.current
        try {
          const id = sessionId ? await generation.projectForSession(sessionId) : null
          if (version === selectionVersion.current && id !== selected.current) {
            let accepted = false
            navigate(() => { accepted = true; change({ selected: id }) })
            if (!accepted && selected.current) selectProject(selected.current)
          }
        } catch (err) { setError(err.message) }
      })
      return () => { window.removeEventListener('elysium:open-project', open); unsubscribe() }
    }, [])
    useEffect(() => {
      const resize = () => setViewport(window.innerWidth)
      window.addEventListener('resize', resize)
      let observer, mountObserver
      const observeSidebar = () => {
        const sidebar = document.querySelector?.('#root [class$="_sidebarCol"]')
        if (!sidebar) return
        mountObserver?.disconnect()
        observer = new ResizeObserver(() => setNativeWidth(sidebar.getBoundingClientRect().width))
        setNativeWidth(sidebar.getBoundingClientRect().width); observer.observe(sidebar)
      }
      if (typeof MutationObserver !== 'undefined') { mountObserver = new MutationObserver(observeSidebar); mountObserver.observe(document.body, { childList: true, subtree: true }) }
      observeSidebar()
      return () => { window.removeEventListener('resize', resize); observer?.disconnect(); mountObserver?.disconnect() }
    }, [])
    useEffect(() => {
      const vars = { '--elysium-list-width': narrow ? '0px' : leftWidth + 'px', '--elysium-detail-width': narrow ? '0px' : rightWidth + 'px', '--elysium-native-nav-width': nativeWidth + 'px' }
      for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value)
      return () => { for (const key of Object.keys(vars)) document.documentElement.style.removeProperty(key) }
    }, [narrow, leftWidth, rightWidth, nativeWidth])
    useEffect(() => {
      const pause = () => document.querySelectorAll?.('.elysium-panel video').forEach(video => video.pause())
      const visibility = () => { if (document.hidden) pause() }
      document.addEventListener('visibilitychange', visibility)
      return () => { pause(); document.removeEventListener('visibilitychange', visibility); document.body.removeAttribute?.('data-elysium-sidebar-dragging') }
    }, [])
    const resizeHandle = side => !narrow && h('div', { className: 'elysium-resize-handle elysium-resize-' + side, role: 'separator', 'aria-label': side === 'left' ? '调整项目列表宽度' : '调整项目详情宽度', 'aria-orientation': 'vertical',
      onPointerDown: event => { event.preventDefault(); drag.current = { side, id: event.pointerId }; event.currentTarget.setPointerCapture?.(event.pointerId); document.body.setAttribute?.('data-elysium-sidebar-dragging', '') },
      onPointerMove: event => { if (drag.current?.id !== event.pointerId) return; change(side === 'left' ? { leftWidth: Math.max(220, Math.min(event.clientX - nativeWidth, available - rightWidth)) } : { rightWidth: Math.max(300, Math.min(viewport - event.clientX, available - leftWidth)) }) },
      onPointerUp: event => { event.currentTarget.releasePointerCapture?.(event.pointerId); drag.current = null; document.body.removeAttribute?.('data-elysium-sidebar-dragging') },
      onPointerCancel: () => { drag.current = null; document.body.removeAttribute?.('data-elysium-sidebar-dragging') },
    })
    return h('div', { className: 'elysium-panel-host', 'data-elysium-panel-host': '' },
      h('aside', { id: 'elysium-workbench-panel', className: 'elysium-panel elysium-library-panel', 'aria-label': '项目与素材工作台' }, resizeHandle('left'),
        h('header', { className: 'elysium-panel-header' }, h('div', { role: 'tablist', 'aria-label': '创作工作台视图' }, [['projects', '项目'], ['materials', '素材'], ['settings', '设置']].map(([tab, label]) => h('button', { key: tab, role: 'tab', 'aria-selected': state.activeTab === tab, onClick: () => leftGuard.current ? leftGuard.current(() => change({ activeTab: tab })) : change({ activeTab: tab }) }, label)))),
        h('div', { className: 'elysium-panel-body' }, error ? h('p', { role: 'alert' }, error) : null, switching ? h('p', { role: 'status' }, '正在切换项目对话…') : null,
          state.activeTab === 'materials' ? h(MaterialList, { viewState: state.materials, onViewState: materials => change({ materials }) }) : state.activeTab === 'settings' ? h(Settings, { guard: leftGuard })
            : h(ProjectList, { viewState: state, onViewState: change, onSelect: selectProject, guard: leftGuard, navigate }))),
      h('aside', { className: 'elysium-panel elysium-detail-panel', 'aria-label': '当前项目详情' }, resizeHandle('right'),
        h('div', { className: 'elysium-panel-body' }, state.selected ? h(ProjectDetail, { key: state.selected, id: state.selected, viewState: state, onViewState: change, guard, navigate, back: () => {} })
          : h('div', { className: 'elysium-series-empty' }, h('strong', null, '选择一个项目开始创作'), h('p', null, '左侧选择项目后，这里展示配置、剧情、分镜和成片，中间对话自动关联该项目。')))))
  }
  function apply(ctx) {
    if (typeof document === 'undefined') return
    ctx.effect(() => {
      const { createRoot } = require('react-dom/client')
      const removeStyles = require('elysium/workbench-styles').apply()
      const host = document.createElement('div'); document.body.append(host)
      const root = createRoot(host); root.render(h(Workbench))
      return () => { root.unmount(); host.remove(); removeStyles() }
    })
  }
  return { Workbench, apply }
} })
