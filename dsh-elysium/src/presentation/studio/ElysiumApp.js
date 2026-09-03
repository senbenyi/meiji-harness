import { createStudio } from './views/videos/Studio.js'
import { createComfyUiSettings } from './views/setting/Settings.js'
import { Modal } from './components/Modal.js'

export function createElysiumApp(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React
  const Studio = createStudio(React, api)
  const ComfyUiSettings = createComfyUiSettings(React, api)

  return function ElysiumApp({ ctx, tab }) {
    const meta = tab?.meta || {}
    const [view, setView] = useState(meta.view === 'comfyui' ? 'comfyui' : 'studio')
    const [selection, setSelection] = useState({ projectId: meta.projectId || null, episodeId: meta.episodeId || null })
    const [settingsDirty, setSettingsDirty] = useState(false)
    const [studioDirty, setStudioDirty] = useState(false)
    const [pendingView, setPendingView] = useState('')

    useEffect(() => {
      if (!settingsDirty && !studioDirty) return undefined
      const warn = event => { event.preventDefault(); event.returnValue = '' }
      window.addEventListener('beforeunload', warn)
      return () => window.removeEventListener('beforeunload', warn)
    }, [settingsDirty, studioDirty])

    const updateMeta = useCallback((nextView, nextSelection = selection) => {
      ctx?.get?.('betterSidebar')?.updateTab?.(tab?.id, {
        meta: { view: nextView, projectId: nextSelection.projectId, episodeId: nextSelection.episodeId },
      })
    }, [ctx, tab?.id, selection])

    const switchView = next => {
      const dirty = view === 'comfyui' ? settingsDirty : studioDirty
      if (next !== view && dirty) {
        setPendingView(next)
        return
      }
      setView(next)
      updateMeta(next)
    }

    const discardAndSwitch = () => {
      if (view === 'comfyui') setSettingsDirty(false)
      else setStudioDirty(false)
      const next = pendingView
      setPendingView('')
      setView(next)
      updateMeta(next)
    }

    const onSelection = useCallback((projectId, episodeId) => {
      const next = { projectId, episodeId }
      setSelection(current => {
        if (current.projectId === projectId && current.episodeId === episodeId) return current
        updateMeta('studio', next)
        return next
      })
    }, [updateMeta])

    return h('div', { className: 'tf-root ely-root' },
      h('header', { className: 'ely-appbar' },
        h('div', { className: 'ely-brand' },
          h('span', null, 'E'),
          h('div', null, h('strong', null, '极乐世界'), h('small', null, 'ELYSIUM STUDIO')),
        ),
        h('nav', { className: 'ely-view-switch' },
          h('button', { className: view === 'studio' ? 'is-active' : '', onClick: () => switchView('studio') }, '制作'),
          h('button', { className: view === 'comfyui' ? 'is-active' : '', onClick: () => switchView('comfyui') }, '设置'),
        ),
      ),
      view === 'comfyui'
        ? h('div', { className: 'ely-settings-wrap' }, h(ComfyUiSettings, { onDirty: setSettingsDirty }))
        : h(Studio, { initialProjectId: selection.projectId, initialEpisodeId: selection.episodeId, onSelection, onDirty: setStudioDirty }),
      pendingView ? Modal(h, {
        title: '放弃未保存修改？',
        onClose: () => setPendingView(''),
        children: h('p', { className: 'tf-confirm-message' }, `${view === 'comfyui' ? '设置' : '当前内容'}还有未保存修改。离开后这些修改将丢失。`),
        actions: [
          h('button', { key: 'cancel', className: 'tf-btn tf-btn-ghost', onClick: () => setPendingView('') }, '继续编辑'),
          h('button', { key: 'discard', className: 'tf-btn tf-btn-danger-solid', onClick: discardAndSwitch }, '放弃并离开'),
        ],
      }) : null,
    )
  }
}
