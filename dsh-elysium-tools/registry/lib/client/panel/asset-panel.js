window.__ModuleLoader__.load('elysium-tools/asset-panel', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { ProjectList } = require('elysium-tools/project')
  const { MaterialList } = require('elysium-tools/asset-list')
  const clamp = width => Math.max(180, Math.min(width, window.innerWidth / 2))
  function PanelToggle({ collapsed, onClick }) {
    return h('button', { className: 'elysium-panel-toggle', onClick, 'aria-expanded': !collapsed, 'aria-label': '切换素材与项目面板' }, collapsed ? '素材与项目面板' : '收起面板')
  }
  function AssetPanel({ toggleRoot }) {
    const [state, setState] = useState(() => {
      let saved = {}
      try { saved = JSON.parse(localStorage.getItem('elysium-panel-state')) || {} } catch { /* Use defaults when browser storage is unavailable. */ }
      return { collapsed: saved.collapsed !== false, width: clamp(Number.isFinite(saved.width) ? saved.width : Math.max(window.innerWidth * .1, 180)), activeTab: ['projects', 'storyboard'].includes(saved.activeTab) ? 'projects' : 'materials' }
    })
    const [dragging, setDragging] = useState(false)
    useEffect(() => {
      try { localStorage.setItem('elysium-panel-state', JSON.stringify(state)) } catch { /* The panel still works without persistence. */ }
      const previous = document.body.style.paddingRight
      if (!state.collapsed) document.body.style.paddingRight = `${state.width}px`
      return () => { document.body.style.paddingRight = previous }
    }, [state])
    useEffect(() => {
      const resize = () => setState(value => ({ ...value, width: clamp(value.width) }))
      window.addEventListener('resize', resize)
      return () => window.removeEventListener('resize', resize)
    }, [])
    useEffect(() => {
      if (!dragging) return
      const previous = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      const move = event => setState(value => ({ ...value, width: clamp(window.innerWidth - event.clientX) }))
      const stop = () => setDragging(false)
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop)
      return () => { document.body.style.userSelect = previous; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop) }
    }, [dragging])
    useEffect(() => { toggleRoot.render(h(PanelToggle, { collapsed: state.collapsed, onClick: () => setState(value => ({ ...value, collapsed: !value.collapsed })) })) }, [state.collapsed])
    if (state.collapsed) return null
    return h('aside', { className: 'elysium-panel', style: { width: state.width }, 'aria-label': '创作素材与项目面板' },
      h('div', { className: 'elysium-panel-resize', onMouseDown: event => { event.preventDefault(); setDragging(true) } }),
      h('div', { className: 'elysium-panel-header', role: 'tablist' },
        ['materials', 'projects'].map(tab => h('button', { key: tab, role: 'tab', 'aria-selected': state.activeTab === tab, className: state.activeTab === tab ? 'elysium-panel-tab elysium-panel-tab-active' : 'elysium-panel-tab', onClick: () => setState(value => ({ ...value, activeTab: tab })) }, tab === 'materials' ? '素材' : '项目'))),
      h('div', { className: 'elysium-panel-body' }, state.activeTab === 'materials' ? h(MaterialList) : h(ProjectList)))
  }
  function apply(ctx) {
    if (typeof document === 'undefined') return
    ctx.effect(() => {
      const { createRoot } = require('react-dom/client')
      const removeStyles = require('elysium-tools/panel-styles').apply()
      const panel = document.createElement('div'), toggle = document.createElement('div')
      document.body.append(panel, toggle)
      const root = createRoot(panel), toggleRoot = createRoot(toggle)
      root.render(h(AssetPanel, { toggleRoot }))
      return () => { root.unmount(); toggleRoot.unmount(); panel.remove(); toggle.remove(); removeStyles() }
    })
  }
  Object.assign(exports, { AssetPanel, PanelToggle, apply })
})
