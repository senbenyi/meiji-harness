import { renderProjectLibrary } from './project-library-view.js'
import { historyTargets } from '../shared/run-view.js'
import { createPanelEvents } from './panel-events.js'
import { renderNodeSkill } from './node-skill.js'
import { generateEpisodeDraft } from './episode-draft.js'
import { appendLogCopy } from './panel-dom.js'
import { tabs } from './flow-view.js'
import { createModelStore, renderModelView, rootProject } from './drama-store.js'
import { renderSkillDetail } from './skill-detail.js'
import { renderSkillLibrary } from './skill-library.js'
import { forgetSkillList, skillList } from './skill-entry.js'
import { renderSettings } from './project-settings-view.js'
import { createShell } from './panel-shell.js'
import { request, jsonBody } from './panel-api.js'
import { renderSession, projectDialog, sourceDialog, storyDialog, catalogDialog } from './project-session-view.js'
import { episodeDialog, overviewDialog, premiseDialog } from './project-overview-view.js'
import { renderLibrary } from './asset-library-view.js'
import { createBridge, currentSessionId, projectRefreshMark } from './chat-bridge.js'
import { gateFromAction, regenerateFields, syncImageGate } from './image-review.js'
import { withRunActivity, runActivityMark } from './run-activity.js'
import { confirmEditDelete } from './run-preview.js'
import { renderScriptView } from './script-view.js'
import { renderRunList } from './run-list.js'
import { renderRunDetail } from './run-detail.js'
import { runStatusLabels, runGoalLabel } from '../shared/run-view.js'

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
  let eventKey = '', refreshing = false, refreshAgain = false, currentPage = null
  const events = createPanelEvents({ onResume: () => {
    if (!eventKey) return
    const [sessionId, projectId] = eventKey.split(':')
    Promise.all([follow(), refreshTasks(projectId, sessionId), currentPage?.isConnected ? currentPage.refresh() : null]).catch(error => shell.status(error.message))
  } })
  // 进行中与暂停的任务常驻底部任务条；点击进入任务详情。
  let liveRuns = [], liveTaskKey = ''
  function paintTasks() {
    const projectId = liveTaskKey.split(':')[1]
    taskBar.replaceChildren()
    for (const run of liveRuns) {
      const row = document.createElement('div'); row.className = 'task-status-row'
      const label = document.createElement('span'); label.textContent = `${runGoalLabel(run, modelStore.get(projectId))} · ${runStatusLabels[run.status]} · ${run.done}/${run.total}`
      const view = document.createElement('button'); view.textContent = '查看'; view.onclick = () => actions.openRun({ id: projectId }, run.id)
      const pause = document.createElement('button'); pause.textContent = run.status === 'paused' ? '处理暂停' : '暂停'
      pause.onclick = async () => {
        if (run.status === 'paused') return actions.openRun({ id: projectId }, run.id)
        pause.disabled = true
        try { await request(`runs/${run.id}/pause`, { method: 'POST', ...jsonBody({ projectId, sessionId: currentSessionId() }) }) } catch (error) { pause.disabled = false; shell.status(error.message) }
      }
      const cancel = document.createElement('button'); cancel.textContent = '取消'
      cancel.onclick = async () => { cancel.disabled = true; try { await request(`runs/${run.id}/cancel`, { method: 'POST', ...jsonBody({ projectId, sessionId: currentSessionId() }) }) } catch (error) { cancel.disabled = false; shell.status(error.message) } }
      row.append(label, view, pause, cancel); taskBar.append(row)
    }
  }

  async function refreshTasks(projectId, sessionId) {
    const query = new URLSearchParams({ projectId, sessionId })
    const runResult = await request(`runs?${query}`)
    if (eventKey !== `${sessionId}:${projectId}`) return

    liveRuns = runResult.runs.filter(run => ['running', 'paused'].includes(run.status))
    liveTaskKey = eventKey
    paintTasks()
    // 进行中的步骤变化时重绘，使按钮禁用状态与实际执行锁一致。
    const root = shownProject && modelStore.get(shownProject)
    if (root && !hold && runActivityMark(liveRuns) !== shownLiveMark) paintProject(root)
  }
  function watchProject(projectId, sessionId) {
    const key = projectId ? `${sessionId}:${projectId}` : ''
    if (key === eventKey) return
    eventKey = key
    liveRuns = []
    liveTaskKey = key
    taskBar.replaceChildren()
    events.watch(key ? '/plugins/meiji/events?' + new URLSearchParams({ projectId, sessionId }) : '', async () => {
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
    })
  }

  let openCharacter = null
  let openScene = null
  let imageGate = null
  let navigation = 0, library, workspace = null, shown = '', shownMark = '', shownLiveMark = '', hold = false, openEpisode = '', openShot = '', shotTab = 'seconds', openTab = '', shownProject = ''
  const display = node => { renderModelView(shell.content, node); paintTasks(); shell.status(''); shell.setOpen(true) }
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
    // 「执行中」由任务的 running 步骤推导，不读服务端字段。
    shownLiveMark = runActivityMark(liveRuns)
    const active = liveRuns.filter(run => run.projectId === project.id)
    const view = { ...withRunActivity(project, active), activeRuns: active, runPauseCount: active.filter(run => run.status === 'paused').length }
    view.episodes = view.episodes.map(episode => ({ ...episode, activeRuns: active.filter(run => run.episodeId === episode.id || run.affectedEpisodes?.includes(episode.id)), runPauseCount: active.filter(run => run.status === 'paused' && (run.episodeId === episode.id || run.affectedEpisodes?.includes(episode.id))).length }))
    hold = false
    navigation++
    imageGate = syncImageGate(view, imageGate)
    setLanguageLabel(project?.outputLanguage)
    display(renderSession(view, openCreate, actions, contextFor()))
  }
  modelStore.subscribe(project => { if (!hold) paintProject(project) })
  const showProject = (project, nextWorkspace = workspace) => {
    workspace = nextWorkspace ?? workspace
    const previous = modelStore.get(project.id)
    const accepted = modelStore.accept(project)
    if (!hold && accepted === previous) paintProject(accepted)
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
  const bridge = createBridge({ request, jsonBody, showProject, onDeleted: result => result.sessionId ? enterWorkspace(result) : follow(true), status: message => shell.status(message) })
  // 人工忽略自审：面板直接执行 review-override（会话工具不能发起）。
  shell.root.addEventListener('meiji-review-override', async event => {
    const { key, onError } = event.detail
    const projectId = shownProject, episodeId = event.detail.episodeId || openEpisode || openCharacter?.episodeId || openScene?.episodeId
    if (!projectId || !episodeId) return
    try {
      const scope = { projectId, sessionId: currentSessionId() }, { runs } = await request('runs?' + new URLSearchParams({ ...scope, episodeId, target: key }))
      const active = runs.find(run => ['running', 'paused'].includes(run.status))
      if (active) {
        const { run } = await request(`runs/${active.id}?` + new URLSearchParams(scope)), reason = run.pause?.reasons.find(reason => reason.target === key && reason.actions.includes('override'))
        if (!reason) throw new Error('当前步骤尚不能人工放行，请查看任务详情')
        await request(`runs/${active.id}/resume`, { method: 'POST', ...jsonBody({ ...scope, action: 'override', stepId: reason.stepId }) })
      } else await bridge.perform({ id: projectId }, 'review-override', { key, episodeId })
    }
    catch (error) { onError?.(); shell.status(error.message) }
  })
  shell.root.addEventListener('meiji-view-failure', event => {
    const root = modelStore.get(shownProject)
    if (!root) return
    const episodeId = event.detail.episodeId || openEpisode || openCharacter?.episodeId || openScene?.episodeId
    actions.openLatestTask({ id: root.id, episodeId }, event.detail.target).catch(error => shell.status(error.message))
  })
  const actions = {
    openLibraryCard: (episodeId, itemId, kind) => { currentPage = null; hold = false; if (kind === 'characters') { openCharacter = { episodeId, itemId }; openScene = null } else if (kind === 'scenes') { openScene = { episodeId, itemId }; openCharacter = null } else { openEpisode = episodeId; openTab = tabs[0].id }; follow(true).catch(error => shell.status(error.message)) },
    openLibrary: (project, kind) => {
      hold = true; navigation++
      currentPage = renderProjectLibrary(rootProject(modelStore, project) || project, kind, { ...actions, load: async () => { const result = await request('projects/' + project.id); result.project = withRunActivity(result.project, liveRuns); return result }, back: () => { currentPage = null; follow(true).catch(error => shell.status(error.message)) } })
      display(currentPage)
    },
    openScript: project => {
      hold = true; navigation++
      const query = new URLSearchParams({ projectId: project.id, sessionId: currentSessionId() })
      currentPage = renderScriptView(rootProject(modelStore, project) || project, {
        perform: actions.perform, openRun: id => actions.openRun(project, id), load: async () => { const result = await request(`script?${query}`); result.project = withRunActivity(result.project, liveRuns); return result },
        back: () => { currentPage = null; follow(true).catch(error => shell.status(error.message)) },
      })
      display(currentPage)
    },
    openLatestTask: async (project, target) => {
      const query = new URLSearchParams({ projectId: project.id, sessionId: currentSessionId(), ...(project.episodeId ? { episodeId: project.episodeId } : {}), target })
      const runs = await request(`runs?${query}`)
      if (runs.runs[0]) return actions.openRun(project, runs.runs[0].id, target)
      actions.openHistory(project, target)
    },
    openHistory: (project, historyScope = '') => {
      hold = true; navigation++
      const root = rootProject(modelStore, project) || project
      const query = new URLSearchParams({ projectId: project.id, sessionId: currentSessionId() })
      const target = historyTargets(historyScope).join(',')
      currentPage = renderRunList(root, { episodeId: project.episodeId || '', target,
        load: () => request(`runs?${query}`),
        open: (run, selectedTarget) => actions.openRun(project, run.id, selectedTarget, () => actions.openHistory(project, historyScope)),
        back: () => { currentPage = null; follow(true).catch(error => shell.status(error.message)) },
      })
      display(currentPage); shell.content.parentElement.scrollTop = 0
    },
    openRun: (project, id, target = '', back = () => actions.openHistory(project)) => {
      hold = true; navigation++
      const sessionId = currentSessionId(), projectId = project.id
      const query = new URLSearchParams({ projectId, sessionId })
      currentPage = renderRunDetail(rootProject(modelStore, project) || project, { target, back,
        followup: choice => actions.perform({ ...project, episodeId: choice.episodeId }, 'run-goal', { goal: choice.goal }),
        load: () => request(`runs/${id}?${query}`),
        loadRecords: (run, step, kind) => request(`runs/${run.id}/steps/${step.id}/${kind}?${query}`),
        control: (run, endpoint, fields = {}) => request(`runs/${run.id}/${endpoint}`, { method: 'POST', ...jsonBody({ projectId, sessionId, ...fields }) }),
        preview: (run, fields) => request(`runs/${run.id}/preview`, { method: 'POST', ...jsonBody({ projectId, sessionId, ...fields }) }),
        edit: (run, target) => {
          const [kind, track] = target.split(':')
          openEpisode = run.episodeId || ''; openShot = track && ['shots', 'seconds', 'storyboard', 'film'].includes(kind) ? track : ''; shotTab = kind === 'storyboard' || kind === 'film' ? 'film' : 'seconds'
          openTab = ['outline', 'characters', 'scenes', 'props'].includes(kind) ? 'script' : kind === 'summary' ? 'summary' : 'shots'
          currentPage = null; hold = false; follow(true).catch(error => shell.status(error.message))
        },
      })
      display(currentPage); shell.content.parentElement.scrollTop = 0
    },
    openCurrentTasks: projectId => {
      const root = modelStore.get(projectId)
      actions.openHistory({ ...root, id: projectId })
    },
    // 技能详情页：只读展示基础，补充通过既有保存接口写入。
    openSkill: (project, id, back = () => follow(true).catch(error => shell.status(error.message))) => {
      hold = true
      navigation++
      const sessionId = currentSessionId(), projectId = project?.id
      const scope = projectId ? { projectId, sessionId } : {}
      display(renderSkillDetail({ id, project: project && { title: project.title } }, {
        back,
        load: () => request(`skills/${id}?` + new URLSearchParams(scope)),
        saveAddition: fields => request('project-skills', { method: 'PUT', ...jsonBody({ ...scope, skill: id, fields }) }),
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
      }))
    },
    skillList,
    reviewImage: async (project, episodeId, draftId, action) => {
      if (!await confirmEditDelete(rootProject(modelStore, project) || project, { action, episodeId, draftId })) { repaint(project); return project }
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
    perform: (project, action, fields) => bridge.perform(rootProject(modelStore, project) || project, action, {
      ...fields,
      ...(project?.episodeId ? { episodeId: project.episodeId } : {}),
    }),
    stage: file => bridge.stage(file),
    importStill: async (project, itemId, file, slot) => {
      const incomingId = await bridge.stage(file)
      const action = slot === 'reference' ? 'set-reference' : slot ? 'part-import' : 'import-image'
      await actions.perform(project, action, { itemId, incomingId, ...(slot && slot !== 'reference' ? { slot } : {}) })
    },
    importLibrary: async (category, file, guidanceType) => {
      const incomingId = await bridge.stage(file, category)
      await bridge.perform(null, 'library-import', { incomingId, category, name: file.name, ...(guidanceType ? { guidanceType } : {}) })
    },
    deleteLibrary: asset => bridge.perform(null, 'library-delete', { category: asset.category, assetId: asset.id }),
    fail: error => shell.status(error.message),
  }
  const openCreate = projectDialog(shell.root, async input => {
    library = undefined
    events.pause()
    let created = false
    try {
      const place = await request('turn', { method: 'POST', ...jsonBody({ action: 'create', sessionId: currentSessionId(), fields: input }) })
      created = true
      enterWorkspace(place)
      if (input.mode === 'script') {
        const sessionId = place.sessionId || currentSessionId(), scope = { projectId: place.projectId, sessionId }
        const planned = await request('runs', { method: 'POST', ...jsonBody({ ...scope, ...goalRequest('project-summary') }) })
        await request(`runs/${planned.run.id}/confirm`, { method: 'POST', ...jsonBody({ ...scope, authorizePrereq: [], confirmDelete: true }) })
      }
    } finally { if (!created) events.resume() }
  })
  const saved = async (project, input) => {
    if (input.outline) await actions.perform(project, 'outline-text', { outline: input.outline })
    else await actions.perform(project, 'source', { fields: input })
  }
  actions.openPremise = premiseDialog(shell.root, (project, text) => actions.perform(project, 'premise-edit', { text }))
  actions.openOverview = overviewDialog(shell.root, async (project, input) => {
    await actions.perform(project, 'overview', { fields: input })
  })
  actions.openSource = sourceDialog(shell.root, saved)
  actions.openStory = storyDialog(shell.root, saved)
  actions.openEpisode = episodeDialog(shell.root, async (project, input) => {
    const fields = { durationSeconds: input.durationSeconds, summary: input.summary, requirements: input.requirements }
    if (input.episodeId) return actions.perform(project, 'episode-edit', { episodeId: input.episodeId, fields })
    else return actions.perform(project, 'episode-add', { fields })
  }, generateEpisodeDraft, {
    openScript: actions.openScript,
    regenerate: (project, fields) => actions.perform(project, 'summary', fields),
    observeSync: async (project, id, onTask) => {
      const query = new URLSearchParams({ projectId: project.id, sessionId: currentSessionId() })
      while (true) {
        const { run } = await request(`runs/${id}?${query}`)
        onTask(run)
        if (run.status !== 'running') return run
        await new Promise(resolve => setTimeout(resolve, 800))
      }
    },
    openHistory: project => actions.openHistory(project, 'summary'),
    loadResponses: (project, task, node) => request(`runs/${task.id}/steps/${node.id}/responses?` + new URLSearchParams({ projectId: project.id, sessionId: currentSessionId() })),
    loadPrompts: (project, task, node) => request(`runs/${task.id}/steps/${node.id}/prompts?` + new URLSearchParams({ projectId: project.id, sessionId: currentSessionId() })),
  })
  const openCatalogDialog = catalogDialog(shell.root)
  function enterWorkspace(place) {
    // Harness restores the selected session from this persisted selection on boot.
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: place.sessionId }))
    window.location.reload()
  }
  async function bind(project) {
    const place = await request('link', { method: 'POST', ...jsonBody({ projectId: project.id, sessionId: currentSessionId() }) })
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
    if (!events.connected()) await refreshTasks(place.projectId, sessionId)
    if (ticket !== navigation && !force) return
    const mark = projectRefreshMark(project)
    if (!force && next === shown && mark === shownMark) return
    hold = false
    showProject(project, place.workspace)
  }
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
