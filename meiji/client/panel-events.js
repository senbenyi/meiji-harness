// 后台标签和写请求等待期间释放同源长连接，避免挤占普通 API 请求。
export function createPanelEvents({ document = globalThis.document, EventSource = document.defaultView.EventSource, onResume = () => {} } = {}) {
  let source = null, url = '', handler, paused = false, disposed = false
  const close = () => { source?.close(); source = null }
  const connect = () => {
    if (source || paused || disposed || document.hidden || !url || !EventSource) return
    const current = source = new EventSource(url)
    current.onmessage = event => { if (source === current) handler?.(event) }
  }
  const visibility = () => {
    if (document.hidden) close()
    else if (!paused && !disposed) { connect(); onResume() }
  }
  const dispose = () => {
    disposed = true
    close()
    document.removeEventListener('visibilitychange', visibility)
    document.defaultView.removeEventListener('pagehide', dispose)
  }
  document.addEventListener('visibilitychange', visibility)
  document.defaultView.addEventListener('pagehide', dispose)
  return {
    watch(next, callback) { if (next !== url) close(); url = next; handler = callback; connect() },
    pause() { paused = true; close() },
    resume() { paused = false; connect() },
    connected() { return source?.readyState === 1 },
    dispose,
  }
}
