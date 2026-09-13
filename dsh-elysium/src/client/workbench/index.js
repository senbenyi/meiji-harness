// 职责：注册并编排项目与素材工作台的导航、持久化和生命周期。
window.__ModuleLoader__.load('elysium/workbench', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { ProjectList } = require('elysium/projects')
  const { trapFocus } = require('elysium/dialog')
  const { MaterialList } = require('elysium/materials')
  function WorkbenchToggle({ collapsed, onClick }) {
    return h('button', { className: 'elysium-panel-toggle', onClick, 'aria-expanded': !collapsed, 'aria-label': '打开创作工作台' }, '创作工作台')
  }
  function Workbench({ toggleRoot }) {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem('elysium-workbench')) || {} } catch {}
      return { open: false, activeTab: saved.activeTab || 'projects', selected: saved.selected || null, projectTab: saved.projectTab || null, materials: {}, projects: saved.projects || {} }
    })
    const root = useRef(null), trigger = useRef(null), guard = useRef(null)
    const change = patch => setState(value => ({ ...value, ...patch }))
    const navigate = action => guard.current ? guard.current(action) : action()
    useEffect(() => {
      try { localStorage.setItem('elysium-workbench', JSON.stringify({ activeTab: state.activeTab, selected: state.selected, projectTab: state.projectTab, projects: Object.fromEntries(Object.entries(state.projects).map(([id, value]) => [id, { selected: value.selected, selectedJob: value.selectedJob, tab: value.tab }])) })) } catch {}
    }, [state.activeTab, state.selected, state.projectTab, state.projects])
    useEffect(() => {
      if (!state.open) return
      document.querySelectorAll?.('.elysium-card video').forEach(video => video.pause())
      trigger.current = document.activeElement
      root.current?.focus()
      const pause = () => document.querySelectorAll?.('.elysium-panel video').forEach(video => video.pause())
      const visibility = () => { if (document.hidden) pause() }
      document.addEventListener('visibilitychange', visibility)
      return () => { pause(); document.removeEventListener('visibilitychange', visibility); trigger.current?.focus?.() }
    }, [state.open])
    useEffect(() => { toggleRoot.render(h(WorkbenchToggle, { collapsed: !state.open, onClick: () => navigate(() => change({ open: !state.open })) })) }, [state.open])
    if (!state.open) return null
    return h('section', { className: 'elysium-panel', 'aria-label': '创作工作台', role: 'dialog', 'aria-modal': true, tabIndex: -1, ref: root, onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); navigate(() => change({ open: false })) } else trapFocus(event, root.current) } },
      h('header', { className: 'elysium-panel-header' }, h('strong', null, '创作工作台'),
        ['projects', 'materials'].map(tab => h('button', { key: tab, role: 'tab', 'aria-selected': state.activeTab === tab, onClick: () => navigate(() => change({ activeTab: tab })) }, tab === 'materials' ? '素材' : '项目')),
        h('button', { className: 'elysium-return', onClick: () => navigate(() => change({ open: false })) }, '返回聊天')),
      h('div', { className: 'elysium-panel-body' }, state.activeTab === 'materials'
        ? h(MaterialList, { viewState: state.materials, onViewState: materials => change({ materials }) })
        : h(ProjectList, { viewState: state, onViewState: change, guard, navigate })))
  }
  function apply(ctx) {
    if (typeof document === 'undefined') return
    ctx.effect(() => {
      const { createRoot } = require('react-dom/client')
      const removeStyles = require('elysium/workbench-styles').apply()
      const panel = document.createElement('div'), toggle = document.createElement('div')
      document.body.append(panel, toggle)
      const root = createRoot(panel), toggleRoot = createRoot(toggle)
      root.render(h(Workbench, { toggleRoot }))
      return () => { root.unmount(); toggleRoot.unmount(); panel.remove(); toggle.remove(); removeStyles() }
    })
  }
  Object.assign(exports, { Workbench, WorkbenchToggle, apply })
})
