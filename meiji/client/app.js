import { renderNodeSkill } from './node-skill.js'
import { generateEpisodeDraft } from './episode-draft.js'
import { renderTaskHistory } from './execution-history.js'
import { renderCurrentTasks } from './current-task.js'
import { appendLogCopy } from './dom.js'
import { tabs } from './flow-view.js'
import { createModelStore, renderModelView, rootProject } from './drama-store.js'
import { renderSkillDetail } from './skill-detail.js'
import { renderSkillLibrary } from './skill-library.js'
import { forgetSkillList, skillList } from './skill-entry.js'
import { renderSettings } from './settings.js'
import { createShell } from './shell.js'
import { request, jsonBody } from './api.js'
import { renderSession, projectDialog, sourceDialog, storyDialog, catalogDialog } from './session.js'
import { episodeDialog, overviewDialog } from './overview.js'
import { renderLibrary } from './library.js'
import { createBridge, currentSessionId, projectRefreshMark } from './chat-bridge.js'
import { gateFromAction, regenerateFields, syncImageGate } from './image-review.js'

function installLogCards() {
  if (installLogCards.started) return
  installLogCards.started = true
  const style = document.createElement('style')
  style.textContent = `
    .meiji-session-log{min-width:0;position:relative}
    .meiji-session-log [data-disclosure-row]{padding-right:68px}
    .meiji-log-copy{position:absolute;top:3px;right:4px;z-index:1;border:1px solid #6666;border-radius:6px;padding:3px 9px;background:transparent;color:inherit;font-size:12px;cursor:pointer}
    .meiji-log-copy:disabled{opacity:.6}
    [data-chat-flow-kind="assistant-step"]::before{content:"大模型";display:block;margin:0 0 6px;color:var(--dsw-alias-label-secondary,#aeb8c6);font-size:13px;line-height:24px}
    .meiji-session-log pre{white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:break-word;max-height:none!important;max-width:100%;box-sizing:border-box;overflow:visible!important}
    .meiji-session-log [data-disclosure-row][aria-expanded="true"]>span:nth-last-child(-n+2){display:none}
  `
  document.head.append(style)
  const reveal = () => {
    for (const card of document.querySelectorAll('[data-variant="others"]')) {
      if (card.dataset.tool) continue
      const row = card.querySelector('[data-disclosure-row]')
      if (!row) continue
      const title = row.querySelector(':scope > span:nth-child(2)')
      if (!title || !(['极乐世界', '日志'].includes(title.textContent.trim()) || title.textContent.trim().startsWith('日志-'))) continue
      if (title.textContent === '极乐世界') title.textContent = '日志'
      card.querySelector(':scope > .meiji-log-card')?.remove()
      card.classList.add('meiji-session-log')
      appendLogCopy(card)
    }
  }
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; reveal() })
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
  reveal()
}

export function mount() {
  installLogCards()
  if (document.querySelector('meiji-workbench')) return
  const shell = createShell()
  const modelStore = createModelStore()
  const taskBar = document.createElement('div')
  taskBar.className = 'task-status'
  shell.root.querySelector('.status').before(taskBar)
  let events, eventKey = '', refreshing = false, refreshAgain = false, currentPage = null
  async function refreshTasks(projectId, sessionId) {
    const result = await request('tasks?' + new URLSearchParams({ projectId, sessionId }))
    if (eventKey !== `${sessionId}:${projectId}`) return
    taskBar.replaceChildren()
    if (result.tasks.length) {
      const view = document.createElement('button')
      view.textContent = '查看当前任务'
      view.className = 'task-status-view'
      view.onclick = () => actions.openCurrentTasks(projectId)
      taskBar.append(view)
    }
    for (const task of result.tasks) {
      const stop = document.createElement('button')
      stop.textContent = `停止生成${task.track ? ' · ' + task.track : ''}`
      stop.onclick = async () => {
        stop.disabled = true
        try { await request('tasks', { method: 'POST', ...jsonBody({ projectId, sessionId, operationId: task.id }) }) }
        catch (error) { shell.status(error.message); stop.disabled = false }
      }
      taskBar.append(stop)
    }
  }
  function watchProject(projectId, sessionId) {
    const key = projectId ? `${sessionId}:${projectId}` : ''
    if (key === eventKey) return
    events?.close()
    eventKey = key
    taskBar.replaceChildren()
    if (!key || typeof EventSource === 'undefined') return
    events = new EventSource('/plugins/meiji/events?' + new URLSearchParams({ projectId, sessionId }))
    events.onmessage = async () => {
      if (key !== eventKey) return
      if (refreshing) { refreshAgain = true; return }
      refreshing = true
      try {
        do {
          refreshAgain = false
          await Promise.all([follow(), refreshTasks(projectId, sessionId), currentPage?.isConnected ? currentPage.refresh() : null])
        } while (refreshAgain && key === eventKey)
      } catch (error) { shell.status(error.message) }
      finally { refreshing = false }
    }
  }
  window.addEventListener('pagehide', () => events?.close(), { once: true })

  let openCharacter = null
  let openScene = null
  let imageGate = null
  let navigation = 0, library, workspace = null, shown = '', shownMark = '', hold = false, openEpisode = '', openShot = '', shotTab = 'seconds', openTab = '', shownProject = ''
  const display = node => { renderModelView(shell.content, node); shell.status(''); shell.setOpen(true) }
  const signature = project => (workspace?.id || '') + ':' + (project?.id || '')
  const contextFor = projects => ({
    workspace,
    projects,
    imageGate,
    onBind: () => openCatalog().catch(error => shell.status(error.message)),
    onPick: project => bind(project).catch(error => shell.status(error.message)),
    character: openCharacter,
    scene: openScene,
    onOpenCharacter: (episodeId, itemId) => { openCharacter = { episodeId, itemId }; openScene = null; follow(true).catch(error => shell.status(error.message)) },
    onBackCharacter: () => { openCharacter = null; follow(true).catch(error => shell.status(error.message)) },
    onOpenScene: (episodeId, itemId) => { openScene = { episodeId, itemId }; openCharacter = null; follow(true).catch(error => shell.status(error.message)) },
    onBackScene: () => { openScene = null; follow(true).catch(error => shell.status(error.message)) },
    episodeId: openEpisode,
    shotId: openShot,
    shotTab,
    tab: openTab,
    onSelectTab: id => { openTab = id },
    onShotTab: id => { shotTab = id },
    onOpenEpisode: id => { openEpisode = id; openShot = ''; openTab = tabs[0].id; shotTab = 'seconds'; follow(true).catch(error => shell.status(error.message)) },
    onOpenShot: id => { openShot = id; shotTab = 'seconds'; follow(true).catch(error => shell.status(error.message)) },
    onBackShot: () => { openShot = ''; openTab = 'shots'; follow(true).catch(error => shell.status(error.message)) },
    onBack: () => { openEpisode = ''; openShot = ''; openTab = ''; shotTab = 'seconds'; follow(true).catch(error => shell.status(error.message)) },
  })
  const paintProject = (project, nextWorkspace = workspace) => {
    workspace = nextWorkspace ?? workspace
    if ((project?.id || '') !== shownProject) { openCharacter = null; openScene = null; openEpisode = ''; openShot = ''; openTab = ''; shotTab = 'seconds'; imageGate = null }
    shownProject = project?.id || ''
    shown = signature(project)
    shownMark = projectRefreshMark(project)
    hold = false
    navigation++
    imageGate = syncImageGate(project, imageGate)
    setLanguageLabel(project?.outputLanguage)
    display(renderSession(project, openCreate, actions, contextFor()))
  }
  modelStore.subscribe(project => { if (!hold) paintProject(project) })
  const showProject = (project, nextWorkspace = workspace) => {
    workspace = nextWorkspace ?? workspace
    const previous = modelStore.get(project.id)
    const accepted = modelStore.accept(project)
    if (accepted === previous || hold) paintProject(accepted)
  }
  // 用当前完整项目重绘（参数可以是剧集视图）。
  const repaint = project => {
    const root = rootProject(modelStore, project)
    if (root) showProject(root)
  }
  const showUnbound = projects => {
    shown = signature(null)
    shownProject = ''
    openCharacter = null
    openScene = null
    openEpisode = ''
    openShot = ''
    imageGate = null
    hold = false
    navigation++
    setLanguageLabel('zh-CN')
    display(renderSession(null, openCreate, actions, contextFor(projects)))
  }
  shell.root.addEventListener('meiji-review-draft', async event => {
    const { key, text, revision, kind, onSaved, onError } = event.detail
    const projectId = shownProject, episodeId = event.detail.episodeId || openEpisode || openCharacter?.episodeId || openScene?.episodeId
    if (!projectId || !episodeId) return
    try {
      const result = await request('review-draft', { method: 'PUT', ...jsonBody({ projectId, episodeId, sessionId: currentSessionId(), key, text, revision, kind }) })
      onSaved(result.review)
      modelStore.accept(result.project)
    } catch (error) { onError(error); shell.status(error.message) }
  })
  const bridge = createBridge({ request, jsonBody, showProject, onDeleted: () => follow(true), status: message => shell.status(message) })
  // 人工忽略自审：面板直接执行 review-override（会话工具不能发起）。
  shell.root.addEventListener('meiji-review-override', async event => {
    const { key, onError } = event.detail
    const projectId = shownProject, episodeId = event.detail.episodeId || openEpisode || openCharacter?.episodeId || openScene?.episodeId
    if (!projectId || !episodeId) return
    try { await bridge.perform({ id: projectId }, 'review-override', { key, episodeId }) }
    catch (error) { onError?.(); shell.status(error.message) }
  })
  const actions = {
    openHistory: (project, historyScope = '') => {
      hold = true
      navigation++
      const sessionId = currentSessionId()
      currentPage = renderTaskHistory(project, {
        historyScope,
        loadPrompts: (task, step) => request('history?' + new URLSearchParams({ projectId: project.id, sessionId, taskId: task.id, stepId: step.id })),
        back: () => { currentPage = null; follow(true).catch(error => shell.status(error.message)) },
        load: (artifactId = '') => request('history?' + new URLSearchParams({ projectId: project.id, ...(project.episodeId ? { episodeId: project.episodeId } : {}), sessionId, ...(artifactId ? { artifactId } : {}) })),
      })
      display(currentPage)
      shell.content.parentElement.scrollTop = 0
    },
    // 「当前任务」页：打开剧集时只看本集，否则看整个项目；收到 /events 推送时刷新。
    openCurrentTasks: projectId => {
      hold = true
      navigation++
      const sessionId = currentSessionId(), root = modelStore.get(projectId)
      const episodeId = openEpisode || openCharacter?.episodeId || openScene?.episodeId || ''
      const index = episodeId ? [...(root?.episodes || [])].reverse().findIndex(episode => episode.id === episodeId) : -1
      const project = { id: projectId, title: root?.title, episodeId, episodeNumber: index >= 0 ? index + 1 : undefined, episodes: root?.episodes }
      currentPage = renderCurrentTasks(project, {
        loadPrompts: (task, step) => request('history?' + new URLSearchParams({ projectId, sessionId, taskId: task.id, stepId: step.id })),
        back: () => { currentPage = null; follow(true).catch(error => shell.status(error.message)) },
        load: () => request('tasks/current?' + new URLSearchParams({ projectId, sessionId, ...(episodeId ? { episodeId } : {}) })),
        stop: task => request('tasks', { method: 'POST', ...jsonBody({ projectId, sessionId, operationId: task.id }) }),
        openHistory: () => { currentPage = null; actions.openHistory(project) },
      })
      display(currentPage)
      shell.content.parentElement.scrollTop = 0
    },
    // 技能详情页：基础 skill 全局修改，本剧补充 / 指导 / 素材写入当前短剧；预览用当前剧集的上下文。
    openSkill: (project, id, back = () => follow(true).catch(error => shell.status(error.message))) => {
      hold = true
      navigation++
      const sessionId = currentSessionId(), projectId = project?.id
      const scope = projectId ? { projectId, sessionId } : {}
      display(renderSkillDetail({ id, project: project && { title: project.title } }, {
        back,
        load: () => request(`skills/${id}?` + new URLSearchParams(scope)),
        saveBase: fields => request(`skills/${id}`, { method: 'PUT', ...jsonBody({ fields, confirm: true }) }),
        reset: (to, field) => request(`skills/${id}/reset`, { method: 'POST', ...jsonBody({ to, field }) }),
        saveAddition: fields => request('project-skills', { method: 'PUT', ...jsonBody({ ...scope, skill: id, fields }) }),
        saveGuidance: enabled => request('project-guidance', { method: 'PUT', ...jsonBody({ ...scope, enabled }) }),
        saveAssets: (stage, guidanceAssetIds) => request('project-guidance', { method: 'PUT', ...jsonBody({ ...scope, stage, guidanceAssetIds }) }),
        loadAssets: () => request('assets?category=guidance'),
        preview: mode => request(`skills/${id}/preview`, { method: 'POST', ...jsonBody({ ...scope, episodeId: project?.episodeId || '', mode }) }),
        open: next => actions.openSkill(project, next, () => actions.openSkill(project, id, back)),
        changed: forgetSkillList,
      }))
      shell.content.parentElement.scrollTop = 0
    },
    openNodeSkill: (project, nodeKey, id) => {
      hold = true
      navigation++
      const scope = { projectId: project.id, sessionId: currentSessionId(), episodeId: project.episodeId, nodeKey }
      display(renderNodeSkill(project, nodeKey, {
        back: () => follow(true).catch(error => shell.status(error.message)),
        load: () => request('node-skills?' + new URLSearchParams(scope)),
        save: fields => request('node-skills', { method: 'PUT', ...jsonBody({ ...scope, ...fields }) }),
        remove: itemId => request('node-skills', { method: 'DELETE', ...jsonBody({ ...scope, id: itemId }) }),
        preview: () => request(`skills/${id}/preview`, { method: 'POST', ...jsonBody(scope) }),
      }))
    },
    skillList,
    reviewImage: async (project, episodeId, draftId, action) => {
      const result = await request('image-review', { method: 'POST', ...jsonBody({ projectId: project.id, sessionId: currentSessionId(), episodeId, draftId, action }) })
      imageGate = null
      showProject(result.project)
      return result.project
    },
    closeImageReview: async () => {
      imageGate = null
      if (shownProject) {
        const { project } = await request('projects/' + shownProject)
        showProject(project)
      } else {
        display(renderSession(null, openCreate, actions, contextFor()))
      }
    },
    beginImage: async (project, action, fields = {}) => {
      const episodeId = fields.episodeId || project.episodeId
      imageGate = gateFromAction(action, { ...fields, episodeId })
      repaint(project)
      try {
        await bridge.perform(project, action, { ...fields, episodeId })
      } catch (error) {
        imageGate = { ...imageGate, phase: 'error', held: false, error: error.message }
        repaint(project)
        throw error
      }
    },
    regenerateImage: async (project, gate, options = {}) => {
      const episodeId = gate.episodeId || project.episodeId
      const note = options.generationMode === 'modify' ? String(options.review || '').trim() : ''
      if (note.length > 2000) throw new Error('审核意见过长')
      const { action, fields } = regenerateFields(gate, note)
      imageGate = {
        ...gate,
        phase: 'generating',
        held: true,
        draftId: '',
        previewUrl: '',
        error: '',
        review: note,
        ignoreDraftId: gate.draftId || '',
        action,
        itemId: fields.itemId || gate.itemId || '',
        itemName: fields.itemName || gate.itemName || gate.name || '',
        slot: fields.slot || gate.slot || '',
        track: fields.track || gate.track || '',
      }
      repaint(project)
      if (gate.draftId && options.generationMode !== 'modify') {
        await request('image-review', { method: 'POST', ...jsonBody({ projectId: project.id, sessionId: currentSessionId(), episodeId, draftId: gate.draftId, action: 'discard-image' }) })
      }
      await bridge.perform(project, action, { ...fields, ...options, draftId: gate.draftId, episodeId })
    },
    refresh: () => follow(true),
    perform: (project, action, fields) => bridge.perform(project, action, {
      ...fields,
      ...(project?.episodeId ? { episodeId: project.episodeId } : {}),
    }),
    importStill: async (project, itemId, file, slot) => {
      const incomingId = await bridge.stage(file)
      const action = slot === 'reference' ? 'set-reference' : slot ? 'part-import' : 'import-image'
      await actions.perform(project, action, { itemId, incomingId, ...(slot && slot !== 'reference' ? { slot } : {}) })
    },
    importLibrary: async (category, file, guidanceType) => {
      const incomingId = await bridge.stage(file, category)
      await bridge.perform(null, 'library-import', { incomingId, category, name: file.name, ...(guidanceType ? { guidanceType } : {}) })
    },
    fail: error => shell.status(error.message),
  }
  const openCreate = projectDialog(shell.root, async input => {
    library = undefined
    const place = await request('turn', { method: 'POST', ...jsonBody({ action: 'create', fields: input }) })
    enterWorkspace(place)
  })
  const saved = async (project, input) => {
    if (typeof input.outline === 'string') await actions.perform(project, 'outline-text', { outline: input.outline })
    else await actions.perform(project, 'source', { fields: input })
  }
  actions.openOverview = overviewDialog(shell.root, async (project, input) => {
    await actions.perform(project, 'overview', { fields: input })
  })
  actions.openSource = sourceDialog(shell.root, saved)
  actions.openStory = storyDialog(shell.root, saved)
  actions.openEpisode = episodeDialog(shell.root, async (project, input) => {
    const fields = { durationSeconds: input.durationSeconds, summary: input.summary }
    if (input.episodeId) await actions.perform(project, 'episode-edit', { episodeId: input.episodeId, fields })
    else await actions.perform(project, 'episode-add', { fields })
  }, generateEpisodeDraft, {
    loadHistory: (project, artifactId = '') => request('history?' + new URLSearchParams({ projectId: project.id, sessionId: currentSessionId(), ...(artifactId ? { artifactId } : {}) })),
    loadPrompts: (project, task, step) => request('history?' + new URLSearchParams({ projectId: project.id, sessionId: currentSessionId(), taskId: task.id, stepId: step.id })),
  })
  const openCatalogDialog = catalogDialog(shell.root)
  function enterWorkspace(place) {
    // Harness restores the selected session from this persisted selection on boot.
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: place.sessionId }))
    window.location.reload()
  }
  async function bind(project) {
    const place = await request('link', { method: 'POST', ...jsonBody({ projectId: project.id }) })
    enterWorkspace(place)
  }
  async function openCatalog() {
    const sessionId = currentSessionId()
    const [place, listed] = await Promise.all([
      request('link?sessionId=' + encodeURIComponent(sessionId)),
      request('projects'),
    ])
    workspace = place.workspace
    openCatalogDialog(listed.projects, workspace, project => { bind(project).catch(error => shell.status(error.message)) })
  }
  async function follow(force = false) {
    const sessionId = currentSessionId()
    if (!sessionId) return
    const ticket = navigation
    const place = await request('link?sessionId=' + encodeURIComponent(sessionId))
    if (ticket !== navigation && !force) return
    workspace = place.workspace
    watchProject(place.projectId, sessionId)
    const next = (place.workspace?.id || '') + ':' + (place.projectId || '')
    if (!force && hold && next === shown) return
    if (!place.projectId) {
      if (!force && next === shown) return
      const { projects } = await request('projects')
      if (ticket !== navigation && !force) return
      showUnbound(projects)
      return
    }
    const { project } = await request('projects/' + place.projectId)
    if (!events || events.readyState !== 1) await refreshTasks(place.projectId, sessionId)
    if (ticket !== navigation && !force) return
    const mark = projectRefreshMark(project)
    if (!force && next === shown && mark === shownMark) return
    showProject(project, place.workspace)
  }
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button[aria-label="选择工作区"]') : null
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    openCatalog().catch(error => shell.status(error.message))
  }, true)
  const languageButton = shell.root.querySelector('.language')
  const setLanguageLabel = outputLanguage => {
    const english = outputLanguage === 'en'
    languageButton.textContent = english ? 'EN' : '中文'
    languageButton.title = english ? '生成语言：English' : '生成语言：简体中文'
  }
  const openSettings = async () => {
    hold = true
    const ticket = ++navigation
    try {
      const sessionId = currentSessionId()
      const place = await request('link?sessionId=' + encodeURIComponent(sessionId))
      if (!place.projectId) throw new Error('请先选择一部短剧，再设置生成语言')
      const { project } = await request('projects/' + place.projectId)
      if (ticket !== navigation) return
      setLanguageLabel(project.outputLanguage)
      const reopen = () => openSettings().catch(error => shell.status(error.message))
      display(renderSettings(project, {
        back: () => follow(true).catch(error => shell.status(error.message)),
        openSkills: () => {
          const library = () => display(renderSkillLibrary({ load: skillList, back: reopen, open: id => actions.openSkill(project, id, library) }))
          library()
        },
        save: async (current, outputLanguage) => {
          await request('project-settings', { method: 'PUT', ...jsonBody({ projectId: current.id, sessionId, outputLanguage }) })
          setLanguageLabel(outputLanguage)
        },
      }))
    } catch (error) {
      if (ticket !== navigation) return
      hold = false
      shell.status(error.message)
    }
  }
  shell.root.querySelector('.brand').onclick = () => { follow(true).catch(error => shell.status(error.message)) }
  shell.root.querySelector('.plus').onclick = openCreate
  languageButton.onclick = () => { openSettings().catch(error => shell.status(error.message)) }
  shell.root.querySelector('.settings').onclick = () => { openSettings().catch(error => shell.status(error.message)) }
  shell.root.querySelector('.library').onclick = () => {
    hold = true
    navigation++
    library = renderLibrary(project => { bind(project).catch(error => shell.status(error.message)) }, actions)
    display(library)
  }
  setInterval(() => { follow().catch(error => shell.status(error.message)) }, 1000)
  follow().catch(error => shell.status(error.message))
}
