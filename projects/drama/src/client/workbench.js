import { element } from './panel-dom.js'
import { projectDialog } from './project-forms.js'
import { renderProjectDetails } from './project-detail.js'
import { renderSettings, renderModelSettings } from './settings-ui.js'

export function currentSessionId() {
  try { return JSON.parse(localStorage.getItem('dsh.sessions.current'))?.sessionId || null }
  catch { return null }
}

export function mount(root, { getSessionId = currentSessionId, fetcher = globalThis.fetch, Events = globalThis.EventSource,
  selectSession = id => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })); window.location.reload() },
} = {}) {
  const header = element('header', '', 'bar'), nav = element('nav', '', 'actions'),
    library = element('button', '片库', 'library'), settings = element('button', '设置', 'settings'),
    content = element('main'), status = element('p', '', 'error')
  library.type = 'button'
  settings.type = 'button'
  status.setAttribute('role', 'status')
  nav.append(library, settings)
  header.append(nav)
  root.append(header, content, status)
  let session, stream, version = 0, disposed = false, switching = null, project = null, page = 'home', modelSettings = null, modelOptions = null, settingsTicket = 0
  const request = async (path, options) => {
    const response = await fetcher(`/api/drama/${path}${path.includes('?') ? '&' : '?'}session_id=${encodeURIComponent(session)}`, options)
    const result = await response.json()
    if (!response.ok) throw new Error(result.message)
    return result
  }
  const activate = id => {
    if (id === session || id === switching || disposed) return
    switching = id
    selectSession(id)
  }
  const report = error => { if (!disposed) status.textContent = error.message }
  const openCreate = () => projectDialog(root, async fields => {
    const result = await request('projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
      body: JSON.stringify({ fields, request_id: crypto.randomUUID() }),
    })
    page = 'project'
    await refresh()
    if (result.session_id !== session) activate(result.session_id)
  })
  const saveSettings = async patch => {
    const result = await request('settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' }, body: JSON.stringify({ settings: patch }) })
    modelSettings = result.settings
  }
  const paint = () => {
    if (page === 'settings') {
      content.replaceChildren()
      const settingsPage = renderSettings(content, {
        settings: modelSettings,
        saveSettings,
        back: () => { page = project ? 'project' : 'home'; paint() },
      })
      if (modelSettings) renderModelSettings(settingsPage, { settings: modelSettings, modelOptions, saveSettings, titles: { session: '主 Agent' } })
      return
    }
    if (page === 'library') {
      content.replaceChildren(element('h2', '片库'))
      content.append(element('p', project ? project.basic_info.name : '还没有项目', 'meta'))
      return
    }
    if (!project) {
      content.replaceChildren()
      const empty = element('div', '', 'home-empty'), plus = element('button', '', 'create-large'), mark = element('span', '＋')
      plus.type = 'button'
      plus.disabled = !session
      plus.setAttribute('aria-label', '创建项目')
      plus.append(mark)
      plus.onclick = openCreate
      empty.append(plus)
      content.append(empty)
      return
    }
    content.replaceChildren(element('h2', project.basic_info.name))
    renderProjectDetails(content, project.basic_info)
  }
  const refresh = async () => {
    const ticket = ++version
    if (!session) {
      project = null
      status.textContent = '请选择或新建短剧会话'
      if (page !== 'settings' && page !== 'library') page = 'home'
      paint()
      return
    }
    const snapshot = await request('project')
    if (disposed || ticket !== version) return
    status.textContent = ''
    project = snapshot.project
    if (page !== 'settings' && page !== 'library') page = project ? 'project' : 'home'
    paint()
  }
  const follow = () => {
    const next = getSessionId()
    if (session === next) return
    session = next
    version++
    stream?.close()
    stream = null
    if (page === 'home') paint()
    if (session) {
      stream = new Events(`/api/drama/events?session_id=${encodeURIComponent(session)}`)
      const source = stream
      source.onmessage = event => {
        if (disposed || source !== stream) return
        const data = JSON.parse(event.data)
        void refresh().then(() => {
          if (!disposed && source === stream && data.type === 'created' && data.session_id !== session)
            activate(data.session_id)
        }).catch(report)
      }
    }
    void refresh().catch(report)
  }
  library.onclick = () => { page = 'library'; paint() }
  settings.onclick = async () => {
    page = 'settings'
    const ticket = ++settingsTicket
    paint()
    try {
      const result = await request('settings')
      if (disposed || page !== 'settings' || ticket !== settingsTicket) return
      modelSettings = result.settings
      modelOptions = result.modelOptions
      paint()
    } catch (error) { report(error) }
  }
  follow()
  const timer = setInterval(follow, 500)
  return { refresh, dispose() { disposed = true; version++; clearInterval(timer); stream?.close(); root.replaceChildren() } }
}
