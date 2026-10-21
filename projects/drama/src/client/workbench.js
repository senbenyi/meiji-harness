import { createTaskHistory } from '@agent-modules/task/ui'
import { createHttpHistory } from '@agent-modules/http-client/ui'
import { element } from './panel-dom.js'
import { projectDialog } from './project-forms.js'
import { renderLibrary } from './library-ui.js'
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
    content = element('main'), status = element('p', '', 'error'),
    shortcuts = element('div', '', 'record-shortcuts'), httpRecords = element('button', 'HTTP记录', 'http-records'), taskRecords = element('button', '任务记录', 'task-records'),
    heading = element('div', '', 'panel-heading'), brand = element('strong', '短剧制作', 'brand'), create = element('button', '+', 'create-project')
  create.type = 'button'
  create.disabled = true
  create.title = '创建项目'
  create.setAttribute('aria-label', '创建项目')
  const titleRow = element('div', '', 'title-row')
  titleRow.append(brand, create)
  httpRecords.type = taskRecords.type = 'button'
  shortcuts.append(httpRecords, taskRecords)
  heading.append(titleRow, shortcuts)
  library.type = 'button'
  settings.type = 'button'
  status.setAttribute('role', 'status')
  nav.append(library, settings)
  header.append(heading, nav)
  root.append(header, content, status)
  let session, stream, version = 0, disposed = false, switching = null, project = null, page = 'home', modelSettings = null, modelOptions = null, settingsTicket = 0
  let settingsReturnPage = 'home', disposeLibrary, recordView
  const libraryState = { tab: 'projects', category: 'characters' }
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
  let starting = null
  const startSession = () => {
    if (starting) return starting
    let requestId
    try { requestId = globalThis.sessionStorage?.getItem('drama.pending-session') } catch {}
    requestId ||= crypto.randomUUID()
    try { globalThis.sessionStorage?.setItem('drama.pending-session', requestId) } catch {}
    status.textContent = '正在准备会话…'
    starting = request('sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
      body: JSON.stringify({ request_id: requestId }),
    }).then(result => {
      if (!disposed && !getSessionId()) activate(result.session_id)
    }).catch(report).finally(() => { starting = null })
    return starting
  }
  const openCreate = () => {
    const existing = root.querySelector('#create-project')
    if (existing) return existing
    const requestId = crypto.randomUUID()
    return projectDialog(root, async fields => {
      const result = await request('projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
        body: JSON.stringify({ fields, request_id: requestId }),
      })
      page = 'project'
      await refresh()
      if (result.session_id !== session) activate(result.session_id)
    }, {
      listScripts: async () => (await request('library')).assets,
      readScript: async id => (await request(`library/scripts/${encodeURIComponent(id)}`)).body,
    })
  }
  const saveSettings = async patch => {
    const result = await request('settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' }, body: JSON.stringify({ settings: patch }) })
    modelSettings = result.settings
  }
  const paint = () => {
    disposeLibrary?.()
    disposeLibrary = null
    recordView?.dispose()
    recordView = null
    if (page === 'http' || page === 'tasks') {
      content.replaceChildren()
      const back = () => { page = project ? 'project' : 'home'; paint() }
      const query = filter => new URLSearchParams(filter).toString()
      if (page === 'http') recordView = createHttpHistory({ document: root.ownerDocument, onBack: back, source: {
        list: async filter => (await request(`http-records?${query(filter)}`)).records,
        read: async id => (await request(`http-records?id=${encodeURIComponent(id)}`)).record,
      } })
      else {
        const nodeTypes = []
        recordView = createTaskHistory({ document: root.ownerDocument, onBack: back, nodeTypes, source: {
        history: async filter => { const data = await request(`task-history?${query(filter)}`); nodeTypes.splice(0, nodeTypes.length, ...data.nodeTypes); return data },
        detail: async id => (await request(`task-history?id=${encodeURIComponent(id)}`)).detail,
      } })
      }
      content.append(recordView.element)
      return
    }
    if (page === 'settings') {
      content.replaceChildren()
      const settingsPage = renderSettings(content, {
        settings: modelSettings,
        saveSettings,
        back: () => { page = ['library', 'http', 'tasks'].includes(settingsReturnPage) ? settingsReturnPage : project ? 'project' : 'home'; paint() },
      })
      if (modelSettings) renderModelSettings(settingsPage, { settings: modelSettings, modelOptions, saveSettings, titles: { session: '主 Agent' } })
      return
    }
    if (page === 'library') {
      disposeLibrary = renderLibrary(content, { state: libraryState, request, openProject: id => {
        page = 'project'
        if (id === session) void refresh().catch(report)
        else activate(id)
      } })
      return
    }
    if (!project) {
      content.replaceChildren()
      const empty = element('div', '', 'home-empty'), plus = element('button', '', 'create-large'), mark = element('span', '＋')
      plus.type = 'button'
      plus.disabled = !session && !!starting
      plus.setAttribute('aria-label', session ? '创建项目' : '开始会话')
      plus.append(mark)
      plus.onclick = () => { if (session) openCreate(); else void startSession() }
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
      status.textContent = starting ? '正在准备会话…' : '开始会话后即可创建项目'
      if (!['settings', 'library', 'http', 'tasks'].includes(page)) page = 'home'
      paint()
      return
    }
    const snapshot = await request('project')
    if (disposed || ticket !== version) return
    status.textContent = ''
    project = snapshot.project
    if (!['settings', 'library', 'http', 'tasks'].includes(page)) page = project ? 'project' : 'home'
    if (recordView && ['http', 'tasks'].includes(page)) await recordView.refresh()
    else paint()
  }
  const follow = () => {
    const next = getSessionId()
    if (session === next) return
    session = next
    create.disabled = !session
    if (session) {
      try { globalThis.sessionStorage?.removeItem('drama.pending-session') } catch {}
    }
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
    if (!session) void startSession()
  }
  httpRecords.onclick = () => { page = 'http'; paint() }
  taskRecords.onclick = () => { page = 'tasks'; paint() }
  create.onclick = openCreate
  library.onclick = () => { page = 'library'; paint() }
  settings.onclick = async () => {
    if (page !== 'settings') settingsReturnPage = page
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
  return { refresh, dispose() { disposed = true; version++; clearInterval(timer); stream?.close(); disposeLibrary?.(); recordView?.dispose(); root.replaceChildren() } }
}
