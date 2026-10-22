const active = new WeakMap()

/** 短暂操作反馈；同一document只保留最新一条，不依赖宿主、项目或主题。返回关闭函数。 */
export function showToast(message, { document = globalThis.document, kind = 'success', duration = 2500 } = {}) {
  if (!document?.body || !document.defaultView) throw new TypeError('toast需要浏览器document')
  if (typeof message !== 'string' || !message.trim()) throw new TypeError('toast消息不能为空')
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('toast展示时长需大于0')
  active.get(document)?.()
  const host = document.createElement('div')
  host.className = 'agent-ui-toast'
  // Shadow DOM隔离宿主的button/p/span等全局样式。
  host.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 32px);pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = ':host{font:14px/1.5 system-ui,sans-serif;color:#f5f5f5}.message{padding:10px 16px;background:#25272d;border:1px solid #4b505b;border-radius:10px;box-shadow:0 8px 28px #0005;white-space:pre-wrap;overflow-wrap:anywhere}.error{border-color:#a75d5d}'
  const content = document.createElement('div')
  content.className = kind === 'error' ? 'message error' : 'message'
  content.setAttribute('role', 'status')
  content.setAttribute('aria-live', 'polite')
  content.textContent = message
  root.append(style, content)
  document.body.append(host)
  const window = document.defaultView
  const close = () => {
    window.clearTimeout(timer)
    host.remove()
    if (active.get(document) === close) active.delete(document)
  }
  const timer = window.setTimeout(close, duration)
  active.set(document, close)
  return close
}
