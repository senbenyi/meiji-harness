export function createShell() {
  const host = document.createElement('drama-workbench')
  const root = host.attachShadow({ mode: 'open' })
  const layout = document.createElement('style')
  layout.textContent = '#root{box-sizing:border-box;padding-right:var(--drama-panel-width,min(360px,44vw))}html[data-drama-resizing],html[data-drama-resizing] *{cursor:col-resize!important;user-select:none!important}@media(max-width:680px){html[data-drama-mobile=open] #root{visibility:hidden;padding-right:0}}'
  document.head.append(layout)
  host.id = 'drama-panel'
  root.innerHTML = `<link rel="stylesheet" href="/plugins/drama/src/client/project-ui.css"><link rel="stylesheet" href="/plugins/drama/src/client/panel-shell.css"><aside class="sidebar" aria-label="短剧工作流面板"><div class="resize-handle" role="separator" aria-label="调整右侧面板宽度" aria-orientation="vertical" tabindex="0"></div><div class="workspace-content"></div></aside>`
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'toggle'
  // Harness的IconPanelLeftOutlineRegular，镜像后分隔线位于右侧。
  toggle.innerHTML = '<svg class="panel-toggle-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" stroke-width="1"><path d="M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor"/><path d="M5.5 1.5V14.5" stroke="currentColor"/></svg>'
  document.body.append(host)
  const sidebar = root.querySelector('.sidebar'), handle = root.querySelector('.resize-handle')
  const stored = Number(localStorage.getItem('drama-panel-width'))
  let preferredWidth = stored > 0 ? stored : Math.min(360, window.innerWidth * .44)
  let width, drag
  const bounds = () => {
    const max = Math.min(window.innerWidth, Math.max(180, window.innerWidth - 280))
    return { min: Math.min(260, max), max }
  }
  const applyWidth = () => {
    const { min, max } = bounds()
    width = Math.round(Math.min(max, Math.max(min, preferredWidth)))
    sidebar.style.setProperty('--drama-expanded-width', `${width}px`)
    document.documentElement.style.setProperty('--drama-panel-width', sidebar.classList.contains('collapsed') ? '48px' : `${width}px`)
    document.documentElement.dataset.dramaMobile = window.innerWidth <= 680 && !sidebar.classList.contains('collapsed') ? 'open' : 'closed'
    handle.setAttribute('aria-valuemin', String(min))
    handle.setAttribute('aria-valuemax', String(max))
    handle.setAttribute('aria-valuenow', String(width))
  }
  const remember = () => { preferredWidth = width; localStorage.setItem('drama-panel-width', String(width)) }
  handle.onpointerdown = event => {
    if (event.button !== 0) return
    event.preventDefault()
    drag = { pointer: event.pointerId, x: event.clientX, width }
    handle.setPointerCapture(event.pointerId)
    sidebar.classList.add('resizing')
    document.documentElement.setAttribute('data-drama-resizing', '')
  }
  handle.onpointermove = event => {
    if (!drag || event.pointerId !== drag.pointer) return
    preferredWidth = drag.width + drag.x - event.clientX
    applyWidth()
  }
  const stopDrag = () => {
    if (!drag) return
    drag = undefined; remember()
    sidebar.classList.remove('resizing')
    document.documentElement.removeAttribute('data-drama-resizing')
  }
  handle.onpointerup = stopDrag
  handle.onpointercancel = stopDrag
  handle.onlostpointercapture = stopDrag
  handle.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    preferredWidth = width + (event.key === 'ArrowLeft' ? 16 : -16)
    applyWidth(); remember()
  }
  window.addEventListener('resize', applyWidth)
  applyWidth()
  const setOpen = open => {
    root.querySelector('.sidebar').classList.toggle('collapsed', !open)
    toggle.title = open ? '收起右侧面板' : '展开右侧面板'
    toggle.setAttribute('aria-label', toggle.title)
    toggle.setAttribute('aria-expanded', String(open))
    applyWidth()
  }
  toggle.onclick = () => setOpen(root.querySelector('.sidebar').classList.contains('collapsed'))
  setOpen(true)
  return { dispose() { stopDrag(); window.removeEventListener('resize', applyWidth); layout.remove(); host.remove(); document.documentElement.style.removeProperty('--drama-panel-width'); delete document.documentElement.dataset.dramaMobile }, root, content: root.querySelector('.workspace-content'), toggle, setOpen, status: message => { root.querySelector('[role=status]').textContent = message } }
}
