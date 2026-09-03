import { createStudio } from './views/Studio.js'
import { createComfyUiSettings } from './views/setting/Settings.js'

export function createElysiumApp(React, api) {
  const { createElement: h, useCallback, useState } = React
  const Studio = createStudio(React, api)
  const ComfyUiSettings = createComfyUiSettings(React, api)

  return function ElysiumApp({ ctx, tab }) {
    const meta = tab?.meta || {}
    const [view, setView] = useState(meta.view === 'comfyui' ? 'comfyui' : 'studio')
    const [selection, setSelection] = useState({ projectId: meta.projectId || null, episodeId: meta.episodeId || null })

    const updateMeta = useCallback((nextView, nextSelection = selection) => {
      ctx?.get?.('betterSidebar')?.updateTab?.(tab?.id, {
        meta: { view: nextView, projectId: nextSelection.projectId, episodeId: nextSelection.episodeId },
      })
    }, [ctx, tab?.id, selection])

    const switchView = next => {
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
          h('button', { className: view === 'comfyui' ? 'is-active' : '', onClick: () => switchView('comfyui') }, '模型'),
        ),
      ),
      view === 'comfyui'
        ? h('div', { className: 'ely-settings-wrap' }, h(ComfyUiSettings))
        : h(Studio, { initialProjectId: selection.projectId, initialEpisodeId: selection.episodeId, onSelection }),
    )
  }
}
