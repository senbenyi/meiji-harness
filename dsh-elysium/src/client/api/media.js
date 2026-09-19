// 职责：封装媒体地址、状态请求、人工重试与跨视图共用的媒体展示值。
window.__ModuleLoader__.load({
  id: 'elysium/media-api', factory: () => {
    function mediaUrl(kind, sessionId, callId, params = {}, baseKey = 'base') {
      const config = window.__ELYSIUM_MEDIA__
      if (!config?.token || !config[baseKey]) throw new Error('媒体服务未加载，请刷新页面或检查媒体服务')
      const query = new URLSearchParams(params)
      if (sessionId) query.set('session', sessionId)
      if (callId) query.set('call', callId)
      query.set('t', config.token)
      // Relative to the page origin: SSH tunnel ports must never be hard-coded.
      return `${config[baseKey]}/${kind}?${query}`
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
    // 人工重试原任务；服务端只启动恢复，进度由状态轮询取得。
    async function retryJob(sessionId, callId) {
      const response = await fetch(mediaUrl('retry', sessionId, callId), { method: 'POST', cache: 'no-store', credentials: 'same-origin' })
      const value = await response.json()
      if (!response.ok) throw Object.assign(new Error(value.error || '重试失败'), { status: response.status })
      return value
    }
    const assetUrl = (kind, job) => mediaUrl(kind, null, null, { job })
    function relativeTime(time) {
      const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
      return !Number.isFinite(minutes) ? '时间未记录' : minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
    }
    return { mediaUrl, readStatus, retryJob, assetUrl, relativeTime }
  },
})
