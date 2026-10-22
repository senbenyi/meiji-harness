let toastContainer

/** 面板初始化时登记一次；销毁时传null解除。容器需有定位属性。 */
export function setToastContainer(container) {
  toastContainer = container
}

/** 在面板中央显示文字提示，2.5秒后自动消失。 */
export function showToast(message) {
  const container = toastContainer?.isConnected ? toastContainer : document.body
  container.querySelector('.agent-ui-toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'agent-ui-toast'
  toast.setAttribute('role', 'status')
  toast.textContent = message
  toast.style.cssText = `position:${container === document.body ? 'fixed' : 'absolute'};top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;box-sizing:border-box;width:max-content;max-width:calc(100% - 32px);padding:10px 16px;border-radius:10px;background:#25272d;color:#f5f5f5;box-shadow:0 8px 28px #0005;font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none`
  container.append(toast)
  setTimeout(() => toast.remove(), 2500)
}
