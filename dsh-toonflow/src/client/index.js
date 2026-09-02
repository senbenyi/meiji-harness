import styles from './toonflow.module.css'
import { createApi } from './api.js'
import { createToonflowApp } from './ToonflowApp.js'

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-toonflow',
  factory: (require) => {
    console.log('[toonflow] client factory executing')
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const api = createApi()
    const ToonflowApp = createToonflowApp(React, api, styles)

    function ToonflowIcon({ size }) {
      return h('svg', {
        width: size || 16,
        height: size || 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('rect', { x: 2, y: 5, width: 12, height: 9, rx: 1.5 }),
      h('path', { d: 'M2 5l3-3h6l3 3' }),
      h('path', { d: 'M5.5 2L7 5' }),
      h('path', { d: 'M10.5 2L9 5' }))
    }

    function firstLeaf(node) {
      return node.kind === 'leaf' ? node : firstLeaf(node.children[0])
    }

    function findTab(node, tabId) {
      if (node.kind === 'leaf') return node.tabs.find(tab => tab.id === tabId)
      for (const child of node.children) {
        const found = findTab(child, tabId)
        if (found) return found
      }
      return undefined
    }

    function removeTab(node, tabId) {
      if (node.kind === 'leaf') {
        const tabs = node.tabs.filter(tab => tab.id !== tabId)
        if (tabs.length === node.tabs.length) return node
        const active = tabs.some(tab => tab.id === node.active)
          ? node.active
          : (tabs[tabs.length - 1]?.id || null)
        return { ...node, tabs, active }
      }
      const children = node.children.map(child => removeTab(child, tabId))
      return children.some((child, index) => child !== node.children[index])
        ? { ...node, children }
        : node
    }

    function appendTab(node, paneId, tab) {
      if (node.kind === 'leaf') {
        return node.id === paneId
          ? { ...node, tabs: [...node.tabs, tab], active: tab.id }
          : node
      }
      const children = node.children.map(child => appendTab(child, paneId, tab))
      return children.some((child, index) => child !== node.children[index])
        ? { ...node, children }
        : node
    }

    function apply(ctx) {
      console.log('[toonflow] apply() called')
      ctx.inject(['betterSidebar'], (scope) => {
        scope.effect(() => {
          const sidebar = scope.betterSidebar
          const disposeTab = sidebar.registerTab({
            id: 'toonflow',
            title: 'Toonflow',
            icon: size => h(ToonflowIcon, { size }),
            order: 60,
            single: true,
            createTab: (state) => {
              const existing = findTab(state.splits, 'toonflow')
                || findTab(state.bottomSplits, 'toonflow')
                || state.floats?.find(item => item.tab.id === 'toonflow')?.tab
              const tab = existing || { id: 'toonflow', type: 'toonflow', title: 'Toonflow' }
              const cleanSplits = removeTab(state.splits, 'toonflow')
              const cleanBottomSplits = removeTab(state.bottomSplits, 'toonflow')
              const target = firstLeaf(cleanSplits)
              return {
                tab,
                patch: {
                  splits: appendTab(cleanSplits, target.id, tab),
                  bottomSplits: cleanBottomSplits,
                  floats: state.floats?.filter(item => item.tab.id !== 'toonflow') || [],
                  activePane: target.id,
                  panelOpen: true,
                },
              }
            },
            component: props => h(ToonflowApp, props),
          })
          console.log('[toonflow] tab registered')

          let opened = false
          let unsubscribe
          const openToonflow = () => {
            if (opened || !sidebar.getSnapshot().state) return
            opened = true
            sidebar.openTab({ type: 'toonflow' })
            unsubscribe?.()
            unsubscribe = undefined
          }
          unsubscribe = sidebar.subscribeState(openToonflow)
          openToonflow()

          return () => {
            unsubscribe?.()
            disposeTab()
          }
        }, 'dsh-toonflow: sidebar tab')
      })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
