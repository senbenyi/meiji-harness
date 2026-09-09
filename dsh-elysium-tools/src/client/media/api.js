window.__ModuleLoader__.load({
  id: 'elysium-tools/media-api', factory: () => {
    function mediaUrl(kind, sessionId, callId) {
      const config = window.__ELYSIUM_MEDIA__
      if (!config?.token) throw new Error('媒体服务未加载，请刷新页面或检查媒体服务')
      const query = new URLSearchParams({ session: sessionId, call: callId, t: config.token })
      // Relative to the page origin: SSH tunnel ports must never be hard-coded.
      return `${config.base}/${kind}?${query}`
    }
    async function readStatus(sessionId, callId, signal, retry = true) {
      const response = await fetch(mediaUrl('status', sessionId, callId), { signal, cache: 'no-store', credentials: 'same-origin' })
      if (response.status === 401 && retry) {
        const refreshed = await fetch(`${window.__ELYSIUM_MEDIA__.base}/credentials`, {
          signal, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Elysium-Media-Refresh': '1' },
        })
        if (refreshed.ok) {
          const config = await refreshed.json()
          if (config.token && config.base === window.__ELYSIUM_MEDIA__.base) {
            window.__ELYSIUM_MEDIA__ = config
            return readStatus(sessionId, callId, signal, false)
          }
        }
      }
      const value = await response.json()
      if (!response.ok) {
        const error = new Error(value.error || '任务状态读取失败')
        error.status = response.status
        throw error
      }
      return value
    }
    return { mediaUrl, readStatus }
  },
})
