import { renderCustomSkill } from './custom-skills.js'
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
    .meiji-session-log{min-width:0}
    [data-chat-flow-kind="assistant-step"]::before{content:"大模型";display:block;margin:0 0 6px;color:var(--dsw-alias-label-secondary,#aeb8c6);font-size:13px;line-height:24px}
    .meiji-session-log pre{white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:break-word;max-height:none!important;max-width:100%;box-sizing:border-box;overflow:visible!important}
    .meiji-session-log [data-disclosure-row][aria-expanded="true"]>span:nth-last-child(-n+2){display:none}
  `
  document.head.append(style)
  const initializedRows = new WeakSet()
  const reveal = () => {
    for (const card of document.querySelectorAll('[data-variant="others"]')) {
      if (card.dataset.tool) continue
      const row = card.querySelector('[data-disclosure-row]')
      if (!row) continue
      const title = row.querySelector(':scope > span:nth-child(2)')
      if (!title || !['极乐世界', '日志'].includes(title.textContent.trim())) continue
      if (title.textContent !== '日志') title.textContent = '日志'
      card.querySelector(':scope > .meiji-log-card')?.remove()
      card.classList.add('meiji-session-log')
      const expanded = row.getAttribute('aria-expanded')
      if (!initializedRows.has(row) && expanded !== null) {
        initializedRows.add(row)
        if (expanded === 'false') row.click()
      }
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
  let openCharacter = null
  let imageGate = null
  let navigation = 0, library, workspace = null, shown = '', shownMark = '', hold = false, openEpisode = '', openShot = '', shotTab = 'seconds', shotsPane = 'table', openTab = '', shownProject = ''
  const display = node => { shell.content.replaceChildren(node); shell.status(''); shell.setOpen(true) }
  const signature = project => (workspace?.id || '') + ':' + (project?.id || '')
  const contextFor = projects => ({
    workspace,
    projects,
    imageGate,
    onBind: () => openCatalog().catch(error => shell.status(error.message)),
    onPick: project => bind(project).catch(error => shell.status(error.message)),
    character: openCharacter,
    onOpenCharacter: (episodeId, itemId) => { openCharacter = { episodeId, itemId }; follow(true).catch(error => shell.status(error.message)) },
    onBackCharacter: () => { openCharacter = null; follow(true).catch(error => shell.status(error.message)) },
    episodeId: openEpisode,
    shotId: openShot,
    shotTab,
    shotsPane,
    tab: openTab,
    onSelectTab: id => { openTab = id },
    onShotTab: id => { shotTab = id },
    onShotsPane: id => { shotsPane = id },
    onOpenEpisode: id => { openEpisode = id; openShot = ''; openTab = 'script'; shotTab = 'seconds'; shotsPane = 'table'; follow(true).catch(error => shell.status(error.message)) },
    onOpenShot: id => { openShot = id; shotTab = 'seconds'; follow(true).catch(error => shell.status(error.message)) },
    onBackShot: () => { openShot = ''; openTab = 'shots'; follow(true).catch(error => shell.status(error.message)) },
    onBack: () => { openEpisode = ''; openShot = ''; openTab = ''; shotTab = 'seconds'; follow(true).catch(error => shell.status(error.message)) },
  })
  const showProject = (project, nextWorkspace = workspace) => {
    workspace = nextWorkspace ?? workspace
    if ((project?.id || '') !== shownProject) { openCharacter = null; openEpisode = ''; openShot = ''; openTab = ''; shotTab = 'seconds'; shotsPane = 'table'; imageGate = null }
    shownProject = project?.id || ''
    shown = signature(project)
    shownMark = projectRefreshMark(project)
    hold = false
    navigation++
    imageGate = syncImageGate(project, imageGate)
    setLanguageLabel(project?.outputLanguage)
    display(renderSession(project, openCreate, actions, contextFor()))
  }
  const showUnbound = projects => {
    shown = signature(null)
    shownProject = ''
    openCharacter = null
    openEpisode = ''
    openShot = ''
    imageGate = null
    hold = false
    navigation++
    setLanguageLabel('zh-CN')
    display(renderSession(null, openCreate, actions, contextFor(projects)))
  }
  const bridge = createBridge({ request, jsonBody, showProject, status: message => shell.status(message) })
  const actions = {
    openCustomSkill: (project, stage) => {
      hold = true
      navigation++
      const sessionId = currentSessionId()
      display(renderCustomSkill(project, stage, {
        back: () => follow(true).catch(error => shell.status(error.message)),
        save: content => request('custom-skill', { method: 'PUT', ...jsonBody({ projectId: project.id, episodeId: project.episodeId, sessionId, stage, content }) }),
      }))
    },
    characterImageUrl: (project, itemId) => '/plugins/meiji/character-image-url?' + new URLSearchParams({ projectId: project.id, episodeId: project.episodeId, itemId, sessionId: currentSessionId() }),
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
      showProject(project)
      try {
        await bridge.perform(project, action, { ...fields, episodeId })
      } catch (error) {
        imageGate = { ...imageGate, phase: 'error', held: false, error: error.message }
        showProject(project)
        throw error
      }
    },
    regenerateImage: async (project, gate, review = '') => {
      const episodeId = gate.episodeId || project.episodeId
      const note = String(review || '').trim()
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
      showProject(project)
      if (gate.draftId) {
        await request('image-review', { method: 'POST', ...jsonBody({ projectId: project.id, sessionId: currentSessionId(), episodeId, draftId: gate.draftId, action: 'discard-image' }) })
      }
      await bridge.perform(project, action, { ...fields, episodeId })
    },
    perform: (project, action, fields) => bridge.perform(project, action, {
      ...fields,
      ...(project?.episodeId ? { episodeId: project.episodeId } : {}),
    }),
    importStill: async (project, itemId, file, slot) => {
      const incomingId = await bridge.stage(file)
      await actions.perform(project, slot ? 'part-import' : 'import-image', { itemId, incomingId, ...(slot ? { slot } : {}) })
    },
    importLibrary: async (category, file) => {
      const incomingId = await bridge.stage(file, category)
      await bridge.perform(null, 'library-import', { incomingId, category, name: file.name })
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
    const next = (place.workspace?.id || '') + ':' + (place.projectId || '')
    if (!force && hold) return
    if (!place.projectId) {
      if (!force && next === shown) return
      const { projects } = await request('projects')
      if (ticket !== navigation && !force) return
      showUnbound(projects)
      return
    }
    const { project } = await request('projects/' + place.projectId)
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
      display(renderSettings(project, {
        back: () => follow(true).catch(error => shell.status(error.message)),
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
