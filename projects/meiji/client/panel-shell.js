export function createShell() {
  const host = document.createElement('meiji-workbench')
  const root = host.attachShadow({ mode: 'open' })
  const layout = document.createElement('style')
  layout.textContent = '#root{box-sizing:border-box;padding-right:var(--meiji-panel-width,min(360px,44vw))}html[data-meiji-resizing],html[data-meiji-resizing] *{cursor:col-resize!important;user-select:none!important}@media(max-width:680px){html[data-meiji-mobile=open] #root{visibility:hidden;padding-right:0}}'
  document.head.append(layout)
  root.innerHTML = `<link rel="stylesheet" href="/plugins/meiji/client/panel-styles.css"><aside class="sidebar" aria-label="短剧工作流面板"><div class="resize-handle" role="separator" aria-label="调整右侧面板宽度" aria-orientation="vertical" tabindex="0"></div><header class="bar"><div class="brand-group"><button class="brand" title="当前项目">极乐世界</button><button class="plus" aria-label="创建短视频项目" title="创建短视频项目">＋</button></div><nav class="actions" aria-label="短剧项目导航"><button class="library">片库</button><button class="language" type="button" aria-label="生成语言，打开设置" title="生成语言">中文</button><button class="settings" aria-label="设置" title="设置">⚙</button><button class="toggle" aria-label="收起右侧面板" aria-expanded="true" title="收起右侧面板"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z" fill="currentColor"/></svg></button></nav></header><div class="body"><main class="content"></main><div class="status" role="status"></div></div></aside>`
  document.body.append(host)
  const sidebar = root.querySelector('.sidebar'), handle = root.querySelector('.resize-handle')
  const stored = Number(localStorage.getItem('meiji-panel-width'))
  let preferredWidth = stored > 0 ? stored : Math.min(360, window.innerWidth * .44)
  let width, drag
  const bounds = () => {
    const max = Math.min(window.innerWidth, Math.max(180, window.innerWidth - 280))
    return { min: Math.min(260, max), max }
  }
  const applyWidth = () => {
    const { min, max } = bounds()
    width = Math.round(Math.min(max, Math.max(min, preferredWidth)))
    sidebar.style.setProperty('--meiji-expanded-width', `${width}px`)
    document.documentElement.style.setProperty('--meiji-panel-width', sidebar.classList.contains('collapsed') ? '48px' : `${width}px`)
    document.documentElement.dataset.meijiMobile = window.innerWidth <= 680 && !sidebar.classList.contains('collapsed') ? 'open' : 'closed'
    handle.setAttribute('aria-valuemin', String(min))
    handle.setAttribute('aria-valuemax', String(max))
    handle.setAttribute('aria-valuenow', String(width))
  }
  const remember = () => { preferredWidth = width; localStorage.setItem('meiji-panel-width', String(width)) }
  handle.onpointerdown = event => {
    if (event.button !== 0) return
    event.preventDefault()
    drag = { pointer: event.pointerId, x: event.clientX, width }
    handle.setPointerCapture(event.pointerId)
    sidebar.classList.add('resizing')
    document.documentElement.setAttribute('data-meiji-resizing', '')
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
    document.documentElement.removeAttribute('data-meiji-resizing')
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
    const toggle = root.querySelector('.toggle')
    toggle.title = open ? '收起右侧面板' : '展开右侧面板'
    toggle.setAttribute('aria-label', toggle.title)
    toggle.setAttribute('aria-expanded', String(open))
    applyWidth()
  }
  root.querySelector('.toggle').onclick = () => setOpen(root.querySelector('.sidebar').classList.contains('collapsed'))
  return { dispose() { window.removeEventListener('resize', applyWidth); layout.remove(); host.remove(); document.documentElement.style.removeProperty('--meiji-panel-width'); delete document.documentElement.dataset.meijiMobile }, root, content: root.querySelector('.content'), setOpen, status: message => { root.querySelector('.status').textContent = message } }
}
