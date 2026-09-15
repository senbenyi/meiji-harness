// 职责：注册并编排项目与素材工作台的导航、侧边栏布局、持久化和生命周期。
window.__ModuleLoader__.load({ id: 'elysium/workbench', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { ProjectList } = require('elysium/projects')
  const { MaterialList } = require('elysium/materials')
  const { ServerList } = require('elysium/servers')
  const { DirectorList } = require('elysium/directors')
  const STORAGE_KEY = 'elysium-workbench'
  const PANEL_MIN = 280

  function PanelRightIcon() {
    return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true },
      h('rect', { x: 1.5, y: 2, width: 13, height: 12, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('rect', { x: 10.5, y: 3.25, width: 2.75, height: 9.5, rx: 1, fill: 'currentColor' }))
  }

  function WorkbenchToggle({ open, onClick }) {
    const label = open ? '收起创作工作台' : '打开创作工作台'
    return h('button', { type: 'button', className: 'elysium-panel-toggle', onClick, 'aria-expanded': open, 'aria-controls': 'elysium-workbench-panel', 'aria-label': label, title: label }, h(PanelRightIcon))
  }

  function Workbench() {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} } catch {}
      const defaultWidth = Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.15))
      const savedWidth = Number(saved.width)
      return { open: false, visited: false, width: Number.isFinite(savedWidth) ? Math.max(PANEL_MIN, savedWidth) : defaultWidth, activeTab: saved.activeTab || 'projects', selected: saved.selected || null, projectTab: saved.projectTab || null, materials: {}, projects: saved.projects || {} }
    })
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
    const narrow = viewportWidth < 768
    const root = useRef(null), guard = useRef(null), resizing = useRef(null), pendingWidth = useRef(null), frame = useRef(null), dragStyle = useRef(null)
    const change = patch => setState(value => ({ ...value, ...patch }))
    const navigate = action => guard.current ? guard.current(action) : action()
    const clampWidth = value => Math.min(window.innerWidth, Math.max(PANEL_MIN, Math.round(value)))
    const toggle = () => navigate(() => setState(value => ({ ...value, open: !value.open, visited: true })))
    const flushResize = () => {
      frame.current = null
      if (pendingWidth.current !== null) change({ width: pendingWidth.current })
    }
    const resize = event => {
      if (resizing.current !== event.pointerId) return
      pendingWidth.current = clampWidth(window.innerWidth - event.clientX)
      if (frame.current === null) {
        const schedule = window.requestAnimationFrame || (run => { run(); return null })
        frame.current = schedule(flushResize)
      }
    }
    const stopResize = event => {
      if (resizing.current !== event.pointerId) return
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      resizing.current = null
      if (pendingWidth.current !== null) change({ width: pendingWidth.current })
      pendingWidth.current = null
      document.body.removeAttribute?.('data-elysium-sidebar-dragging')
      if (dragStyle.current) {
        document.body.style.cursor = dragStyle.current.cursor
        document.body.style.userSelect = dragStyle.current.userSelect
        dragStyle.current = null
      }
    }

    useEffect(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ width: state.width, activeTab: state.activeTab, selected: state.selected, projectTab: state.projectTab, projects: Object.fromEntries(Object.entries(state.projects).map(([id, value]) => [id, { selected: value.selected, selectedJob: value.selectedJob, tab: value.tab }])) })) } catch {}
    }, [state.width, state.activeTab, state.selected, state.projectTab, state.projects])
    useEffect(() => {
      const resizeViewport = () => setViewportWidth(window.innerWidth)
      window.addEventListener('resize', resizeViewport)
      return () => window.removeEventListener('resize', resizeViewport)
    }, [])
    useEffect(() => {
      const width = state.open && !narrow ? Math.min(state.width, viewportWidth) : 0
      document.documentElement.style.setProperty('--elysium-sidebar-width', `${width}px`)
      return () => document.documentElement.style.removeProperty('--elysium-sidebar-width')
    }, [state.open, state.width, narrow, viewportWidth])
    useEffect(() => {
      if (!state.open) return
      document.querySelectorAll?.('.elysium-card video').forEach(video => video.pause())
      root.current?.focus()
      const pause = () => document.querySelectorAll?.('.elysium-panel video').forEach(video => video.pause())
      const visibility = () => { if (document.hidden) pause() }
      document.addEventListener('visibilitychange', visibility)
      return () => { pause(); document.removeEventListener('visibilitychange', visibility) }
    }, [state.open])
    useEffect(() => () => {
      if (frame.current !== null) window.cancelAnimationFrame?.(frame.current)
      document.body.removeAttribute?.('data-elysium-sidebar-dragging')
      if (dragStyle.current) {
        document.body.style.cursor = dragStyle.current.cursor
        document.body.style.userSelect = dragStyle.current.userSelect
      }
    }, [])

    return h('div', { className: 'elysium-panel-host', 'data-elysium-panel-host': '' },
      h('div', { className: 'elysium-toggle-cluster' }, h(WorkbenchToggle, { open: state.open, onClick: toggle })),
      h('aside', { id: 'elysium-workbench-panel', className: `elysium-panel${state.open ? '' : ' elysium-panel-hidden'}`, 'aria-label': '创作工作台', 'aria-hidden': !state.open, style: { width: narrow ? '100%' : `${Math.min(state.width, viewportWidth)}px` }, tabIndex: -1, ref: root, onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); navigate(() => change({ open: false })) } } },
        h('div', { className: 'elysium-resize-handle', role: 'separator', 'aria-label': '调整创作工作台宽度', 'aria-orientation': 'vertical', onPointerDown: event => {
          if (narrow) return
          event.preventDefault()
          resizing.current = event.pointerId
          pendingWidth.current = state.width
          dragStyle.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
          document.body.setAttribute?.('data-elysium-sidebar-dragging', '')
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }, onPointerMove: resize, onPointerUp: stopResize, onPointerCancel: stopResize }),
        h('header', { className: 'elysium-panel-header' },
          h('div', { role: 'tablist', 'aria-label': '创作工作台视图' }, [['projects', '项目'], ['materials', '素材'], ['directors', '导演'], ['servers', '模型']].map(([tab, label]) => h('button', { key: tab, type: 'button', role: 'tab', 'aria-selected': state.activeTab === tab, onClick: () => navigate(() => change({ activeTab: tab })) }, label)))),
        h('div', { className: 'elysium-panel-body' }, state.visited && (state.activeTab === 'materials'
          ? h(MaterialList, { viewState: state.materials, onViewState: materials => change({ materials }) })
          : state.activeTab === 'servers' ? h(ServerList, { guard }) : state.activeTab === 'directors' ? h(DirectorList) : h(ProjectList, { viewState: state, onViewState: change, guard, navigate })))))
  }

  function apply(ctx) {
    if (typeof document === 'undefined') return
    ctx.effect(() => {
      const { createRoot } = require('react-dom/client')
      const removeStyles = require('elysium/workbench-styles').apply()
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      root.render(h(Workbench))
      return () => { root.unmount(); host.remove(); removeStyles() }
    })
  }
  Object.assign(exports, { Workbench, apply })
  return exports
} })
