import { showToast } from '@agent-modules/ui'
import { taskHistoryPresentation } from './ui/task-presentation.js'
import { createTaskHistory } from '@agent-modules/task/ui'
import { createHttpHistory } from '@agent-modules/http-client/ui'
import { element } from './ui/panel-dom.js'
import { nodeUi } from './ui/node-registry.js'
import { renderLibrary } from './ui/library-ui.js'
import { createProjectView } from './project-overview.js'
import { renderSettings, renderModelSettings } from './ui/settings-ui.js'

const { projectDialog } = nodeUi('project').panel

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
  let session, stream, deletingSession = null, version = 0, disposed = false, switching = null, project = null, scriptExecution = null, summaryExecution = null, page = 'home', modelSettings = null, modelOptions = null, settingsTicket = 0
  let settingsReturnPage = 'home', libraryReturnPage = 'home', disposeLibrary, recordView
  const libraryState = { tab: 'assets', category: 'scripts' }
  let projectView, projectViewId, sessionReady = false, eventCursor = null
  let storyExecution = null
  const projectStates = new Map()
  const clearProject = () => { projectView?.dispose(); projectView = null; projectViewId = null }
  const request = async (path, options, ownerSession = session) => {
    const ownerEpoch = navigationEpoch
    // 浏览器HTTP/1连接数有限；历史读取先释放自己的SSE连接，避免请求排队。
    if (/^(http-records|task-history)(\?|$)/.test(path)) { stream?.close(); stream = null }
    const response = await fetcher(`/api/drama/${path}${path.includes('?') ? '&' : '?'}session_id=${encodeURIComponent(ownerSession)}`, options)
    const result = await response.json()
    if (!response.ok) throw new Error(result.message)
    if (path === 'project' && eventCursor === null && ownerSession === session && getSessionId() === ownerSession && navigationEpoch === ownerEpoch) {
      const initialCursor = response.headers?.get?.('X-Drama-Event-Cursor')
      if (/^\d+$/.test(initialCursor || '') && Number.isSafeInteger(Number(initialCursor))) eventCursor = Number(initialCursor)
    }
    return result
  }
  const activate = id => {
    if (id === session || id === switching || disposed) return
    switching = id
    selectSession(id)
  }
  const report = error => { if (!disposed) status.textContent = error.message }
  let starting = null, startingContext = null, navigationEpoch = 0
  const startSession = () => {
    const ownerSession = getSessionId(), ownerEpoch = navigationEpoch
    if (starting && startingContext.session === ownerSession && startingContext.epoch === ownerEpoch) return starting
    const stillHere = () => !disposed && getSessionId() === ownerSession && navigationEpoch === ownerEpoch
    let requestId
    try { if (!starting) requestId = globalThis.sessionStorage?.getItem('drama.pending-session') } catch {}
    requestId ||= crypto.randomUUID()
    try { globalThis.sessionStorage?.setItem('drama.pending-session', requestId) } catch {}
    status.textContent = '正在准备会话…'
    const attempt = request('sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
      body: JSON.stringify({ request_id: requestId }),
    }, ownerSession).then(result => {
      try {
        if (globalThis.sessionStorage?.getItem('drama.pending-session') === requestId)
          globalThis.sessionStorage.removeItem('drama.pending-session')
      } catch {}
      if (stillHere()) activate(result.session_id)
    }).catch(error => { if (stillHere()) report(error) }).finally(() => {
      if (starting === attempt) { starting = null; startingContext = null }
    })
    starting = attempt
    startingContext = { session: ownerSession, epoch: ownerEpoch }
    return attempt
  }
  // 宿主默认新会话会复用项目工作区；此处仅适配原生全局新建入口。
  const newSessionClick = event => {
    if (disposed || event.defaultPrevented || event.button !== 0 || event.composedPath().includes(root)) return
    const button = event.composedPath().find(node => node?.tagName === 'BUTTON')
    if (!button?.matches('button[aria-label="新建会话"], button[aria-label="New session"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void startSession()
  }
  root.ownerDocument.addEventListener('click', newSessionClick, true)
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
      if (result.session_id !== session) { activate(result.session_id); return }
      await refresh()
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
    if (page !== 'project' || !project || projectViewId !== project.basic_info.id) clearProject()
    disposeLibrary?.()
    disposeLibrary = null
    recordView?.dispose()
    recordView = null
    if (page === 'http' || page === 'tasks') {
      content.replaceChildren()
      const back = () => { page = project ? 'project' : 'home'; paint() }
      const query = filter => new URLSearchParams(filter).toString()
      if (page === 'http') recordView = createHttpHistory({ document: root.ownerDocument, onNotify: message => showToast(message), onBack: back, source: {
        list: async filter => (await request(`http-records?${query(filter)}`)).records,
        read: async id => (await request(`http-records?id=${encodeURIComponent(id)}`)).record,
      } })
      else {
        const nodeTypes = []
        recordView = createTaskHistory({ document: root.ownerDocument, onNotify: message => showToast(message), presentation: taskHistoryPresentation, onBack: back, nodeTypes, source: {
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
      if (!status.querySelector('button') && status.textContent.includes('项目已删除')) status.replaceChildren()
      disposeLibrary = renderLibrary(content, { state: libraryState, request, back: () => {
        page = ['settings', 'http', 'tasks'].includes(libraryReturnPage) ? libraryReturnPage : project ? 'project' : 'home'
        paint()
      }, openProject: id => {
        page = 'project'
        if (id === session) void refresh().catch(report)
        else activate(id)
      }, removeAsset: asset => request(`library/scripts/${encodeURIComponent(asset.id)}`, { method: 'DELETE', headers: { 'X-Drama-Request': '1' } }),
      removeProject: async item => {
        const ownerSession = item.session_id
        const current = session === ownerSession || project?.basic_info.id === item.id
        if (current) { deletingSession = session; version++; stream?.close(); stream = null }
        let deleted
        try {
          deleted = await request('project', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
            body: JSON.stringify({ project_id: item.id }),
          }, ownerSession)
        } catch (error) {
          if (current && deletingSession === session) { deletingSession = null; syncEvents() }
          throw error
        }
        if (!current || disposed || (session !== ownerSession && project?.basic_info.id !== item.id)) return
        project = null
        projectStates.delete(item.id)
        clearProject()
        if (page === 'project') page = 'home'
        paint()
        if (deleted.session_id && (session === ownerSession || getSessionId() === ownerSession)) { activate(deleted.session_id); return }
        if (session !== ownerSession) return
        const message = element('span', deleted.session_error || '创建空会话失败。'), retry = element('button', '重试创建空会话')
        retry.type = 'button'
        retry.onclick = async () => {
          if (disposed || session !== ownerSession || getSessionId() !== ownerSession) return
          retry.disabled = true
          try {
            const next = await request('sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
              body: JSON.stringify({ request_id: deleted.session_request_id }) }, ownerSession)
            if (!disposed && session === ownerSession && getSessionId() === ownerSession) activate(next.session_id)
          } catch (error) { if (!disposed && session === ownerSession && getSessionId() === ownerSession) message.textContent = `创建空会话失败：${error.message}` }
          finally { retry.disabled = false }
        }
        status.replaceChildren(message, retry)
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
    if (projectView) { projectView.update(project, { scriptExecution, summaryExecution, storyExecution }); return }
    const ownerSession = session, projectId = project.basic_info.id
    projectViewId = projectId
    if (!projectStates.has(projectId)) projectStates.set(projectId, {})
    projectView = createProjectView(content, { project, scriptExecution, summaryExecution, storyExecution, request: path => request(path, undefined, ownerSession), dialogRoot: root, state: projectStates.get(projectId),
      refresh: () => { void refresh().catch(report) },
      generateStory: async (instruction, requestId) => {
        if (disposed || session !== ownerSession || getSessionId() !== ownerSession || project?.basic_info.id !== projectId) throw new Error('会话已切换，请重新打开项目')
        return request('story-outline', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
          body: JSON.stringify({ project_id: projectId, request_id: requestId, instruction }),
        }, ownerSession)
      },
      optimize: async (instruction, requestId) => {
        if (disposed || session !== ownerSession || project?.basic_info.id !== projectId) throw new Error('会话已切换，请重新打开项目')
        return request('script-optimization', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
          body: JSON.stringify({ project_id: projectId, request_id: requestId, instruction }),
        }, ownerSession)
      },
      remove: async () => {
        if (disposed || session !== ownerSession || getSessionId() !== ownerSession || project?.basic_info.id !== projectId) throw new Error('会话已切换，请重新打开项目')
        deletingSession = ownerSession; version++; stream?.close(); stream = null
        let deleted
        try { deleted = await request('project', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
          body: JSON.stringify({ project_id: projectId }),
        }, ownerSession) }
        catch (error) { if (deletingSession === ownerSession) { deletingSession = null; syncEvents() }
          throw error }
        if (disposed || session !== ownerSession || getSessionId() !== ownerSession) return
        version++; project = null; projectStates.delete(projectId)
        if (page === 'project') page = 'home'
        clearProject(); paint()
        if (deleted.session_id) { status.textContent = '项目已删除，正在切换到空会话…'; activate(deleted.session_id); return }
        const message = element('span', deleted.session_error || '项目已删除，创建空会话失败。'), retry = element('button', '重试创建空会话')
        retry.type = 'button'
        retry.onclick = async () => {
          if (disposed || session !== ownerSession || getSessionId() !== ownerSession) return
          retry.disabled = true
          try {
            const next = await request('sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
              body: JSON.stringify({ request_id: deleted.session_request_id }) }, ownerSession)
            if (!disposed && session === ownerSession && getSessionId() === ownerSession) activate(next.session_id)
          } catch (error) { if (!disposed && session === ownerSession && getSessionId() === ownerSession) message.textContent = `项目已删除，创建空会话失败：${error.message}` }
          finally { retry.disabled = false }
        }
        status.replaceChildren(message, retry)
      },
      save: async command => {
        if (disposed || session !== ownerSession || project?.basic_info.id !== projectId) throw new Error('会话已切换，请重新打开项目')
        const result = await request('project', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Drama-Request': '1' },
          body: JSON.stringify({ project_id: projectId, command, ...(command.kind === 'import_script' ? { request_id: crypto.randomUUID() } : {}) }),
        }, ownerSession)
        if (disposed || session !== ownerSession || project?.basic_info.id !== projectId) return
        version++
        project = result.project
        if (result.warning) status.textContent = result.warning
        return project
      },
    })
  }
  const refresh = async () => {
    const ticket = ++version
    const ownerSession = session, ownerEpoch = navigationEpoch
    if (!session) {
      project = null
      status.textContent = starting ? '正在准备会话…' : '开始会话后即可创建项目'
      if (!['settings', 'library', 'http', 'tasks'].includes(page)) page = 'home'
      paint()
      return
    }
    const snapshot = await request('project')
    if (disposed || ticket !== version || session !== ownerSession || getSessionId() !== ownerSession || navigationEpoch !== ownerEpoch) return
    status.textContent = ''
    sessionReady = true
    project = snapshot.project
    scriptExecution = snapshot.script_execution || null
    storyExecution = snapshot.story_execution || null
    summaryExecution = snapshot.original_summary_execution || null
    if (!['settings', 'library', 'http', 'tasks'].includes(page)) page = project ? 'project' : 'home'
    if (recordView && ['http', 'tasks'].includes(page)) await recordView.refresh()
    else paint()
    syncEvents()
  }
  const syncEvents = () => {
    const viewingRecords = page === 'http' || page === 'tasks' || projectView?.isShowingRecords
    if (disposed || !session || deletingSession === session || root.ownerDocument.visibilityState === 'hidden' || viewingRecords) {
      stream?.close(); stream = null
      return
    }
    if (stream || !sessionReady) return
    stream = new Events(`/api/drama/events?session_id=${encodeURIComponent(session)}${eventCursor === null ? '' : `&cursor=${eventCursor}`}`)
    const source = stream
    const ownerSession = session, ownerEpoch = navigationEpoch
    source.onmessage = event => {
      if (disposed || source !== stream || session !== ownerSession || getSessionId() !== ownerSession || navigationEpoch !== ownerEpoch) return
      const data = JSON.parse(event.data)
      if (Number.isSafeInteger(data.cursor)) eventCursor = data.type === 'refresh' ? data.cursor : Math.max(eventCursor ?? 0, data.cursor)
      if (data.type === 'created' && data.session_id && data.session_id !== ownerSession
        && (!data.source_session_id || data.source_session_id === ownerSession)) {
        activate(data.session_id)
        return
      }
      void refresh().catch(report)
    }
  }
  const follow = () => {
    const next = getSessionId()
    if (session === next) { syncEvents(); return }
    navigationEpoch++
    clearProject()
    deletingSession = null
    project = null
    scriptExecution = summaryExecution = null
    session = next
    sessionReady = false
    eventCursor = null
    create.disabled = !session
    if (session) {
      try { globalThis.sessionStorage?.removeItem('drama.pending-session') } catch {}
    }
    version++
    stream?.close()
    stream = null
    if (page === 'home') paint()
    syncEvents()
    void refresh().catch(report)
    if (!session) void startSession()
  }
  httpRecords.onclick = () => { page = 'http'; paint() }
  taskRecords.onclick = () => { page = 'tasks'; paint() }
  create.onclick = openCreate
  library.onclick = () => {
    if (page !== 'library') libraryReturnPage = page
    page = 'library'
    paint()
  }
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
  return { refresh, dispose() { disposed = true; version++; root.ownerDocument.removeEventListener('click', newSessionClick, true); clearInterval(timer); stream?.close(); disposeLibrary?.(); recordView?.dispose(); clearProject(); root.replaceChildren() } }
}
