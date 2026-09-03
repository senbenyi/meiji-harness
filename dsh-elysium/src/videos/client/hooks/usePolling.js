export function createUsePolling(React) {
  const { useEffect } = React

  return function usePolling(enabled, poll, intervalMs = 2500) {
    useEffect(() => {
      if (!enabled) return
      let active = true
      let running = false
      const tick = async () => {
        if (!active || running || document.visibilityState === 'hidden') return
        running = true
        try { await poll() } catch { /* the owning hook reports request errors */ }
        finally { running = false }
      }
      const timer = setInterval(tick, intervalMs)
      void tick()
      return () => {
        active = false
        clearInterval(timer)
      }
    }, [enabled, poll, intervalMs])
  }
}
