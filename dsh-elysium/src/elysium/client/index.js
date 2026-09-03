import './elysium.css'
import { createApi } from './api.js'
import { createElysiumApp } from './ElysiumApp.js'
import * as React from 'react'

const h = React.createElement
const api = createApi()
const ElysiumApp = createElysiumApp(React, api)

    function ElysiumIcon({ size }) {
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

    export function registerElysium(ctx) {
      console.log('[elysium] apply() called')
      ctx.inject(['betterSidebar'], (scope) => {
        scope.effect(() => {
          const sidebar = scope.betterSidebar
          const disposeTab = sidebar.registerTab({
            id: 'elysium',
            title: '极乐工厂',
            icon: size => h(ElysiumIcon, { size }),
            order: 60,
            single: true,
            createTab: (state) => {
              const existing = findTab(state.splits, 'elysium')
                || findTab(state.bottomSplits, 'elysium')
                || state.floats?.find(item => item.tab.id === 'elysium')?.tab
              const tab = existing || { id: 'elysium', type: 'elysium', title: '极乐工厂' }
              const cleanSplits = removeTab(state.splits, 'elysium')
              const cleanBottomSplits = removeTab(state.bottomSplits, 'elysium')
              const target = firstLeaf(cleanSplits)
              return {
                tab,
                patch: {
                  splits: appendTab(cleanSplits, target.id, tab),
                  bottomSplits: cleanBottomSplits,
                  floats: state.floats?.filter(item => item.tab.id !== 'elysium') || [],
                  activePane: target.id,
                  panelOpen: true,
                },
              }
            },
            component: props => h(ElysiumApp, props),
          })
          console.log('[elysium] tab registered')

          let opened = false
          let unsubscribe
          const openElysium = () => {
            if (opened || !sidebar.getSnapshot().state) return
            opened = true
            sidebar.openTab({ type: 'elysium' })
            unsubscribe?.()
            unsubscribe = undefined
          }
          unsubscribe = sidebar.subscribeState(openElysium)
          openElysium()

          return () => {
            unsubscribe?.()
            disposeTab()
          }
        }, 'dsh-elysium: sidebar tab')
      })
    }
