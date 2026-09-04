import { createConfirmDialog, Modal } from '../../components/Modal.js'
import { openCreationSession } from '../../creation-session.js'

const EMPTY_DRAFT = { title: '', sourceText: '', targetDurationSec: 10, aspectRatio: '9:16', profile: 'preview', budget: '', stylePrompt: '', castPrompt: '' }

const STAGES = [
  { key: 'story', label: '故事', short: '01' },
  { key: 'script', label: '剧本', short: '02' },
  { key: 'assets', label: '资产', short: '03' },
  { key: 'plan', label: '规划', short: '04' },
  { key: 'start_frame', label: '起始帧', short: '05' },
  { key: 'keyframes', label: '关键帧', short: '06' },
  { key: 'chapters', label: '章节', short: '07' },
  { key: 'final', label: '成片', short: '08' },
]

const STATUS = {
  draft: ['草稿', 'neutral'], queued: ['排队中', 'working'], running: ['生产中', 'working'],
  paused: ['已暂停', 'neutral'], needs_attention: ['需要处理', 'danger'], awaiting_review: ['等待终审', 'review'],
  approved: ['已完成', 'success'], ready: ['准备就绪', 'neutral'], pending: ['未开始', 'neutral'], succeeded: ['已完成', 'success'], failed: ['失败', 'danger'],
}

const PROJECT_VIEWS = [
  ['all', '全部'], ['running', '进行中'], ['attention', '待处理'], ['done', '已完成'],
]
const EPISODE_PAGE_SIZE = 25
const CREATION_STATUS = {
  director_selected: '等待创建会话', conversation_created: '等待加载 Skill', skill_loaded: '准备创作',
  story_developing: '剧情创作中', story_ready: '剧情待汇总', awaiting_story_approval: '等待剧情确认',
  story_approved: '剧情已确认', syncing_to_production: '正在写入制作流程', production_ready: '已进入制作',
}

function matchesView(status, view) {
  if (view === 'running') return ['running', 'queued'].includes(status)
  if (view === 'attention') return ['needs_attention', 'failed', 'awaiting_review'].includes(status)
  if (view === 'done') return status === 'approved'
  return true
}

export function projectProductionSummary(episodes = []) {
  return episodes.reduce((summary, item) => {
    summary.total += 1
    if (item.status === 'approved') summary.done += 1
    if (['running', 'queued'].includes(item.status)) summary.running += 1
    if (['needs_attention', 'failed'].includes(item.status)) summary.failed += 1
    if (item.status === 'awaiting_review') summary.review += 1
    return summary
  }, { total: 0, done: 0, running: 0, failed: 0, review: 0 })
}

function summaryPriority(summary) {
  if (summary.failed) return 0
  if (summary.review) return 1
  if (summary.running) return 2
  if (summary.total && summary.done === summary.total) return 4
  return 3
}

function projectSummaryText(summary) {
  const parts = [`${summary.done}/${summary.total} 集已完成`]
  if (summary.running) parts.push(`${summary.running} 生产中`)
  if (summary.failed) parts.push(`${summary.failed} 失败`)
  if (summary.review) parts.push(`${summary.review} 待审核`)
  return parts.join(' · ')
}

function storedValue(key, fallback) {
  try { return window.sessionStorage.getItem(key) || fallback } catch { return fallback }
}

function makeEpisodeId() { return `episode-${Date.now().toString(36)}` }
function storyFingerprint(value = {}) {
  return JSON.stringify({
    title: value.title || '', sourceText: value.sourceText || '', targetDurationSec: Number(value.targetDurationSec || 0),
    aspectRatio: value.aspectRatio || '9:16', profile: value.profile || 'preview', stylePrompt: value.stylePrompt || '', castPrompt: value.castPrompt || '',
  })
}
function cloneValue(value) { return JSON.parse(JSON.stringify(value)) }
function editableStageValue(detail, stage) {
  if (stage === 'story') return {
    title: detail.episode.title || '',
    sourceText: detail.episode.sourceText || '',
    targetDurationSec: Number(detail.episode.targetDurationSec || 10),
    aspectRatio: detail.episode.aspectRatio || '9:16',
    profile: detail.episode.profile || 'preview',
    stylePrompt: detail.episode.stylePrompt || '',
    castPrompt: detail.episode.castPrompt || '',
  }
  if (stage === 'script') return cloneValue(detail.script || { synopsis: '', scenes: [] })
  if (stage === 'plan') return cloneValue(detail.plan || { source: 'edited', chapters: [] })
  return null
}
function statusMeta(status) { return STATUS[status] || [status || '未知', 'neutral'] }
function visibleStage(stage) { return STAGES.some(item => item.key === stage) ? stage : ['review', 'approved'].includes(stage) ? 'final' : 'story' }
function taskLabel(task) {
  return ({ asset: '人物定妆', start_frame: '章节起始帧', keyframe: '连续关键帧', chapter: '长视频章节', final: '静音成片', audio: '同步音效成片' })[task.type] || task.type
}
function tasksForStage(tasks, stage) {
  const type = { start_frame: 'start_frame', keyframes: 'keyframe', chapters: 'chapter', final: 'final' }[stage]
  if (stage === 'final') return (tasks || []).filter(task => ['final', 'audio'].includes(task.type))
  return type ? (tasks || []).filter(task => task.type === type) : []
}
function stageState(detail, stage, index) {
  if (!detail) return 'pending'
  const tasks = stage === 'assets' ? (detail.tasks || []).filter(task => task.type === 'asset') : tasksForStage(detail.tasks, stage)
  if (tasks.some(task => ['needs_attention', 'failed'].includes(task.status))) return 'attention'
  if (tasks.length && tasks.every(task => task.status === 'succeeded')) return 'complete'
  if (tasks.some(task => ['running', 'queued'].includes(task.status))) return 'active'
  if (stage === 'story' && detail.episode?.sourceText) return 'complete'
  if (stage === 'script' && detail.plan?.source !== 'auto-draft' && detail.script?.scenes?.length) return 'complete'
  if (stage === 'plan' && detail.plan?.source !== 'auto-draft' && detail.plan?.chapters?.length) return 'complete'
  const currentIndex = STAGES.findIndex(item => item.key === detail.state?.activeStage)
  if (currentIndex === index && ['running', 'queued'].includes(detail.state?.status)) return 'active'
  return 'pending'
}

export function episodesInCreationOrder(episodes) {
  return [...(episodes || [])].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))
}

export function bulkProductionRequests(projectEpisodes, action) {
  const statuses = action === 'pause' ? ['running', 'queued'] : ['ready', 'paused']
  return projectEpisodes.flatMap(project => project.episodes
    .filter(episode => statuses.includes(episode.status))
    .map(episode => ({
      route: action === 'pause' ? '/production.pause' : episode.status === 'paused' ? '/production.resume' : '/production.start',
      body: {
        projectId: project.projectId,
        episodeId: episode.id,
        ...(action === 'start' && episode.status === 'ready' ? { confirmAuthorizedContent: true } : {}),
      },
    })))
}

export function createStudio(React, api) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React
  const ConfirmDialog = createConfirmDialog(React)

  function StatusPill({ status }) {
    const [label, tone] = statusMeta(status)
    return h('span', { className: `ely-status is-${tone}` }, h('i'), label)
  }

  function Field({ label, hint, children }) {
    return h('label', { className: 'ely-field' }, h('span', { className: 'ely-field-label' }, label), children, hint ? h('small', null, hint) : null)
  }

  return function Studio({ ctx, initialProjectId, initialEpisodeId, onSelection, onDirty }) {
    const [projects, setProjects] = useState([])
    const [projectsLoading, setProjectsLoading] = useState(true)
    const [episodeLoading, setEpisodeLoading] = useState(false)
    const [projectId, setProjectId] = useState(initialProjectId || '')
    const [episodeIdToOpen, setEpisodeIdToOpen] = useState(initialEpisodeId || '')
    const [workspaceView, setWorkspaceView] = useState(initialEpisodeId ? 'episode' : initialProjectId ? 'project' : 'overview')
    const [projectView, setProjectView] = useState(() => storedValue('elysium.projectView', 'all'))
    const [projectQuery, setProjectQuery] = useState(() => storedValue('elysium.projectQuery', ''))
    const [attentionQueue, setAttentionQueue] = useState('all')
    const [episodeView, setEpisodeView] = useState('all')
    const [episodeQuery, setEpisodeQuery] = useState('')
    const [episodePage, setEpisodePage] = useState(1)
    const [selectedProjectIds, setSelectedProjectIds] = useState([])
    const [batchAuthorized, setBatchAuthorized] = useState(false)
    const [projectEpisodes, setProjectEpisodes] = useState({})
    const [episode, setEpisode] = useState(null)
    const [activeStage, setActiveStage] = useState('story')
    const [editor, setEditor] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [authorized, setAuthorized] = useState(false)
    const [reviewed, setReviewed] = useState(false)
    const [reviewWatched, setReviewWatched] = useState(false)
    const [reviewer, setReviewer] = useState('')
    const [showProjectForm, setShowProjectForm] = useState(false)
    const [projectTitle, setProjectTitle] = useState('')
    const [directors, setDirectors] = useState([])
    const [creativeDraft, setCreativeDraft] = useState({ title: '', directorId: '' })
    const [creationState, setCreationState] = useState(null)
    const [creationLoading, setCreationLoading] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState(null)
    const [pendingNavigation, setPendingNavigation] = useState(null)
    const [draft, setDraft] = useState({ ...EMPTY_DRAFT })
    const busyRef = useRef(false)

    const selectedEpisodeId = episode?.episode?.id || ''
    const selectedProject = projects.find(project => project.id === projectId)
    const openIssues = (episode?.issues || []).filter(issue => issue.status === 'open')
    const completeTasks = (episode?.tasks || []).filter(task => task.status === 'succeeded').length
    const totalTasks = episode?.tasks?.length || 0
    const progress = totalTasks ? Math.round((completeTasks / totalTasks) * 100) : 0
    const activeTasks = (episode?.tasks || []).filter(task => ['running', 'queued'].includes(task.status)).length
    const editorDirty = !!editor && JSON.stringify(editor.draft) !== editor.original
    const draftDirty = storyFingerprint(draft) !== storyFingerprint(EMPTY_DRAFT)
    const creativeDraftDirty = !!creativeDraft.title.trim()
    const storyValid = !!episode?.episode?.title.trim() && !!episode?.episode?.sourceText.trim() && Number(episode?.episode?.targetDurationSec) >= 10 && Number(episode?.episode?.targetDurationSec) <= 600
    const storyDraftValid = editor?.stage !== 'story' || (!!editor.draft.title.trim() && !!editor.draft.sourceText.trim() && Number(editor.draft.targetDurationSec) >= 10 && Number(editor.draft.targetDurationSec) <= 600)
    const draftValid = !!draft.title.trim() && !!draft.sourceText.trim() && Number(draft.targetDurationSec) >= 10 && Number(draft.targetDurationSec) <= 600
    const hasPlan = episode?.plan?.source !== 'auto-draft' && !!episode?.script?.scenes?.length && !!episode?.plan?.chapters?.length
    const storyLocked = ['running', 'queued'].includes(episode?.state?.status)
    const selectedEpisodes = selectedProjectIds.flatMap(id => projectEpisodes[id] || [])
    const batchStartCount = selectedEpisodes.filter(item => ['ready', 'paused'].includes(item.status)).length
    const batchPauseCount = selectedEpisodes.filter(item => ['running', 'queued'].includes(item.status)).length
    const currentStage = STAGES.find(item => item.key === activeStage) || STAGES[0]
    const completedStageCount = episode ? STAGES.filter((stage, index) => stageState(episode, stage.key, index) === 'complete').length : 0
    const projectRows = projects.map(project => {
      const episodes = projectEpisodes[project.id] || []
      return { project, episodes, summary: projectProductionSummary(episodes) }
    })
    const viewCounts = projectRows.reduce((counts, row) => {
      counts.all += 1
      if (row.summary.running) counts.running += 1
      if (row.summary.failed || row.summary.review) counts.attention += 1
      if (row.summary.total && row.summary.done === row.summary.total) counts.done += 1
      return counts
    }, { all: 0, running: 0, attention: 0, done: 0 })
    const normalizedProjectQuery = projectQuery.trim().toLowerCase()
    const visibleProjectRows = projectRows.filter(row => {
      const inView = projectView === 'all'
        || (projectView === 'running' && row.summary.running)
        || (projectView === 'attention' && (row.summary.failed || row.summary.review))
        || (projectView === 'done' && row.summary.total && row.summary.done === row.summary.total)
      const matchesQuery = !normalizedProjectQuery || row.project.title.toLowerCase().includes(normalizedProjectQuery)
        || row.episodes.some(item => item.title.toLowerCase().includes(normalizedProjectQuery))
      return inView && matchesQuery
    }).sort((a, b) => summaryPriority(a.summary) - summaryPriority(b.summary) || a.project.title.localeCompare(b.project.title, 'zh-CN'))
    const queueEpisodes = projectView === 'all' || projectView === 'done' ? [] : visibleProjectRows.flatMap(row => row.episodes
      .filter(item => matchesView(item.status, projectView)
        && (projectView !== 'attention' || attentionQueue === 'all'
          || (attentionQueue === 'failed' && ['needs_attention', 'failed'].includes(item.status))
          || (attentionQueue === 'review' && item.status === 'awaiting_review')))
      .map(item => ({ project: row.project, episode: item })))
    const currentEpisodes = projectEpisodes[projectId] || []
    const normalizedEpisodeQuery = episodeQuery.trim().toLowerCase()
    const filteredEpisodes = currentEpisodes.filter(item => matchesView(item.status, episodeView)
      && (!normalizedEpisodeQuery || item.title.toLowerCase().includes(normalizedEpisodeQuery)))
    const episodePages = Math.max(1, Math.ceil(filteredEpisodes.length / EPISODE_PAGE_SIZE))
    const pagedEpisodes = filteredEpisodes.slice((episodePage - 1) * EPISODE_PAGE_SIZE, episodePage * EPISODE_PAGE_SIZE)

    useEffect(() => { onDirty?.(editorDirty || draftDirty || creativeDraftDirty) }, [editorDirty, draftDirty, creativeDraftDirty, onDirty])
    useEffect(() => { setReviewWatched(false); setReviewed(false) }, [episode?.state?.final?.path])
    useEffect(() => { try { window.sessionStorage.setItem('elysium.projectView', projectView) } catch {} }, [projectView])
    useEffect(() => { try { window.sessionStorage.setItem('elysium.projectQuery', projectQuery) } catch {} }, [projectQuery])
    useEffect(() => { setEpisodePage(1) }, [episodeView, episodeQuery, projectId])

    const call = useCallback(async (route, body = {}, quiet = false) => {
      if (!quiet && busyRef.current) return null
      if (!quiet) busyRef.current = true
      if (!quiet) { setBusy(true); setError(''); setMessage('') }
      try { return await api.fetchJson(route, body) }
      catch (reason) { setError(reason.message || String(reason)); return null }
      finally { if (!quiet) { busyRef.current = false; setBusy(false) } }
    }, [])

    const loadProjects = useCallback(async () => {
      const result = await call('/project.list', {}, true)
      if (!result) { setProjectsLoading(false); return }
      const nextProjects = result.projects || []
      setProjects(nextProjects)
      setSelectedProjectIds(current => current.filter(id => nextProjects.some(project => project.id === id)))
      const lists = await Promise.all(nextProjects.map(async project => {
        try {
          const listed = await api.fetchJson('/episode.list', { projectId: project.id })
          return [project.id, episodesInCreationOrder(listed.episodes)]
        } catch { return [project.id, []] }
      }))
      setProjectEpisodes(Object.fromEntries(lists))
      setProjectsLoading(false)
    }, [call, projectId])

    const loadEpisodes = useCallback(async (id = projectId) => {
      if (!id) { setEpisode(null); setEpisodeLoading(false); return }
      setEpisodeLoading(true)
      const result = await call('/episode.list', { projectId: id }, true)
      if (!result) { setEpisodeLoading(false); return }
      const ordered = episodesInCreationOrder(result.episodes)
      setProjectEpisodes(current => ({ ...current, [id]: ordered }))
      const wanted = episodeIdToOpen || (workspaceView === 'episode' && episode?.episode?.projectId === id ? episode.episode.id : '')
      const next = ordered.find(item => item.id === wanted)
      if (!next) { setEpisode(null); setEditor(null); setEpisodeLoading(false); return }
      const detail = await call('/episode.get', { projectId: id, episodeId: next.id }, true)
      if (detail) { setEpisode(detail); setEditor(null); setActiveStage(visibleStage(detail.state?.activeStage)) }
      setEpisodeLoading(false)
    }, [call, projectId, episodeIdToOpen, episode?.episode?.id, episode?.episode?.projectId, workspaceView])

    const loadCreation = useCallback(async (id = projectId) => {
      if (!id) { setCreationState(null); return null }
      setCreationLoading(true)
      const result = await call('/creation.get_state', { projectId: id }, true)
      setCreationState(result)
      setCreationLoading(false)
      return result
    }, [call, projectId])

    const refresh = useCallback(async (quiet = true) => {
      if (!projectId || !selectedEpisodeId) return
      const result = await call('/production.status', { projectId, episodeId: selectedEpisodeId }, quiet)
      if (result) {
        setEpisode(result)
        setEditor(null)
        setProjectEpisodes(current => ({ ...current, [projectId]: (current[projectId] || []).map(item => item.id === selectedEpisodeId
          ? { ...item, title: result.episode.title, status: result.state.status, activeStage: result.state.activeStage }
          : item) }))
      }
    }, [call, projectId, selectedEpisodeId])

    useEffect(() => { void loadProjects() }, [])
    useEffect(() => { void loadEpisodes(projectId) }, [projectId, episodeIdToOpen])
    useEffect(() => {
      if (selectedProject?.kind === 'creative') void loadCreation(selectedProject.id)
      else setCreationState(null)
    }, [selectedProject?.id, selectedProject?.kind])
    useEffect(() => {
      if (workspaceView !== 'creative-create' || directors.length) return
      void call('/director.list', {}, true).then(result => {
        const items = result?.directors || []
        setDirectors(items)
        setCreativeDraft(current => ({ ...current, directorId: current.directorId || items[0]?.id || '' }))
      })
    }, [workspaceView, directors.length, call])
    useEffect(() => {
      if (selectedProject?.kind !== 'creative' || !projectId || creationState?.creation?.status === 'production_ready') return undefined
      const timer = window.setInterval(() => void loadCreation(projectId), 3000)
      return () => window.clearInterval(timer)
    }, [selectedProject?.kind, projectId, creationState?.creation?.status, loadCreation])
    useEffect(() => { onSelection?.(projectId || null, selectedEpisodeId || null) }, [projectId, selectedEpisodeId, onSelection])
    useEffect(() => {
      if (!['running', 'queued'].includes(episode?.state?.status)) return undefined
      const timer = window.setInterval(() => void refresh(true), 2500)
      return () => window.clearInterval(timer)
    }, [episode?.state?.status, refresh])

    const createProject = async () => {
      if (!projectTitle.trim()) return setError('请输入名称')
      const result = await call('/project.create', { title: projectTitle.trim() })
      if (!result) return
      setProjectTitle(''); setShowProjectForm(false); await loadProjects(); setProjectId(result.project.id); setEpisodeIdToOpen(''); setEpisode(null); setWorkspaceView('create')
    }

    const runSessionSetup = async state => openCreationSession({
      ctx,
      sidebar: ctx?.get?.('betterSidebar') || ctx?.betterSidebar,
      project: state.project || selectedProject,
      creation: state.creation,
      director: state.director || directors.find(item => item.id === creativeDraft.directorId),
      openingPrompt: state.openingPrompt,
      skill: state.skill,
      bindSession: body => api.fetchJson('/creation.bind_session', body),
    })

    const createCreativeProject = async () => {
      const title = creativeDraft.title.trim()
      const director = directors.find(item => item.id === creativeDraft.directorId)
      if (!title || !director || busyRef.current) return
      busyRef.current = true
      setBusy(true); setError(''); setMessage('')
      let created
      try {
        created = await api.fetchJson('/creation.create_project', { title, directorId: director.id })
        setProjectId(created.project.id)
        setEpisodeIdToOpen('')
        setEpisode(null)
        setWorkspaceView('project')
        setCreativeDraft({ title: '', directorId: director.id })
        await loadProjects()
        await runSessionSetup({ ...created, director })
      } catch (reason) {
        setError(created
          ? `项目已保存，但创作会话尚未就绪：${reason.message || String(reason)}。可在项目页重试。`
          : (reason.message || String(reason)))
        if (created) {
          await loadProjects()
          await loadCreation(created.project.id)
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    }

    const openCreativeConversation = async () => {
      if (!creationState || busyRef.current) return
      busyRef.current = true
      setBusy(true); setError(''); setMessage('')
      try { await runSessionSetup(creationState) }
      catch (reason) { setError(reason.message || String(reason)) }
      finally { busyRef.current = false; setBusy(false) }
    }

    const approveAndSyncStory = async () => {
      const creation = creationState?.creation
      if (!creation?.storyHash || busyRef.current) return
      busyRef.current = true
      setBusy(true); setError(''); setMessage('')
      try {
        if (!creation.approval) {
          await api.fetchJson('/creation.approve_story', {
            projectId,
            storyHash: creation.storyHash,
            compliance: creation.storyDraft?.compliance,
            confirmedBy: 'user',
          })
        }
        const synced = await api.fetchJson('/creation.sync_to_production', { projectId, storyHash: creation.storyHash })
        const detail = await api.fetchJson('/episode.get', { projectId, episodeId: synced.episodeId })
        setCreationState(synced)
        setEpisode(detail)
        setEpisodeIdToOpen(synced.episodeId)
        setActiveStage('story')
        setWorkspaceView('episode')
        await loadProjects()
        setMessage('剧情已确认并写入制作流程')
      } catch (reason) {
        setError(`剧情确认结果已保留；写入制作流程可重试：${reason.message || String(reason)}`)
        await loadCreation(projectId)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    }

    const reopenCreativeStory = async () => {
      const result = await call('/creation.reopen_story', { projectId, reason: '用户从界面退回创作' })
      if (!result) return
      setCreationState(result)
      setMessage('剧情已退回创作；已有产物未删除')
      await openCreationSession({
        ctx,
        sidebar: ctx?.get?.('betterSidebar') || ctx?.betterSidebar,
        project: selectedProject,
        creation: result.creation,
        director: result.director,
        openingPrompt: creationState?.openingPrompt,
        skill: creationState?.skill,
        bindSession: body => api.fetchJson('/creation.bind_session', body),
      }).catch(reason => setError(reason.message || String(reason)))
    }

    const navigateSafely = (label, action) => {
      if (editorDirty || draftDirty) return setPendingNavigation({ label, action })
      action()
    }

    const discardAndNavigate = () => {
      const action = pendingNavigation?.action
      setPendingNavigation(null)
      setDraft({ ...EMPTY_DRAFT })
      setCreativeDraft(current => ({ title: '', directorId: current.directorId }))
      setEditor(null)
      action?.()
    }

    const selectProject = id => {
      if (id === projectId && workspaceView === 'project') return
      navigateSafely('切换', () => {
        setProjectId(id)
        setEpisodeIdToOpen('')
        setEpisode(null)
        setEditor(null)
        setWorkspaceView('project')
      })
    }

    const openOverview = view => navigateSafely('返回总览', () => {
      setProjectView(view)
      setProjectId('')
      setEpisodeIdToOpen('')
      setEpisode(null)
      setEditor(null)
      setWorkspaceView('overview')
    })

    const createEpisodeIn = id => {
      navigateSafely('新建单集', () => {
        setProjectId(id)
        setEpisodeIdToOpen('')
        setEpisode(null)
        setEditor(null)
        setDraft({ ...EMPTY_DRAFT })
        setActiveStage('story')
        setWorkspaceView('create')
      })
    }

    const deleteProject = async () => {
      if (!projectToDelete) return
      const deletedId = projectToDelete.id
      const result = await call('/project.delete', { projectId: deletedId })
      if (!result) return
      setProjects(current => current.filter(project => project.id !== deletedId))
      setSelectedProjectIds(current => current.filter(id => id !== deletedId))
      setProjectEpisodes(current => {
        const next = { ...current }
        delete next[deletedId]
        return next
      })
      if (projectId === deletedId) {
        setProjectId('')
        setEpisodeIdToOpen('')
        setEpisode(null)
        setWorkspaceView('overview')
      }
      setProjectToDelete(null)
    }

    const toggleProject = id => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    }

    const toggleAllProjects = ids => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])])
    }

    const runBulk = async action => {
      if (busyRef.current) return
      if (!selectedProjectIds.length) return
      if (action === 'start' && !batchAuthorized) return setError('批量启动前请确认所选内容合规且素材权利清晰')
      busyRef.current = true
      setBusy(true); setError(''); setMessage('')
      try {
        const projectEpisodes = await Promise.all(selectedProjectIds.map(async id => ({
          projectId: id,
          episodes: (await api.fetchJson('/episode.list', { projectId: id })).episodes || [],
        })))
        const requests = bulkProductionRequests(projectEpisodes, action)
        if (!requests.length) {
          setMessage(action === 'pause' ? '所选内容中没有正在生产的单集' : '所选内容中没有可启动或继续的单集')
          return
        }
        const results = await Promise.allSettled(requests.map(request => api.fetchJson(request.route, request.body)))
        const failures = results.filter(result => result.status === 'rejected')
        const succeeded = results.length - failures.length
        if (failures.length) setError(`已处理 ${succeeded} 个单集，${failures.length} 个失败：${failures[0].reason?.message || '未知错误'}`)
        setProjectEpisodes(current => {
          const next = { ...current }
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') return
            const request = requests[index]
            next[request.body.projectId] = (next[request.body.projectId] || []).map(item => item.id === request.body.episodeId
              ? { ...item, status: action === 'pause' ? 'paused' : 'running' }
              : item)
          })
          return next
        })
        if (action === 'start') setBatchAuthorized(false)
        if (selectedProjectIds.includes(projectId)) await loadEpisodes(projectId)
      } catch (reason) {
        setError(reason.message || String(reason))
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    }

    const createEpisode = async () => {
      if (!projectId) return setError('请先新建')
      if (!draft.title.trim() || !draft.sourceText.trim()) return setError('请填写单集名称和故事')
      if (!draftValid) return setError('目标时长必须在 10–600 秒之间')
      const result = await call('/episode.create', { projectId, episodeId: makeEpisodeId(), ...draft, budget: draft.budget === '' ? null : Number(draft.budget) })
      if (!result) return
      setEpisode(result); setEditor(null); setDraft({ ...EMPTY_DRAFT }); setActiveStage('story'); setWorkspaceView('episode')
      setEpisodeIdToOpen(result.episode.id)
      setProjectEpisodes(current => ({ ...current, [projectId]: episodesInCreationOrder([...(current[projectId] || []), { ...result.episode, status: result.state.status, activeStage: result.state.activeStage }]) }))
    }

    const chooseEpisode = (ownerProjectId, id) => {
      if (ownerProjectId === projectId && id === selectedEpisodeId) return
      navigateSafely('切换单集', () => {
        setEpisode(null)
        setEditor(null)
        setProjectId(ownerProjectId)
        setEpisodeIdToOpen(id)
        setAuthorized(false)
        setReviewed(false)
        setWorkspaceView('episode')
      })
    }

    const beginEditing = stage => {
      if (storyLocked || !['story', 'script', 'plan'].includes(stage)) return
      const value = editableStageValue(episode, stage)
      setError('')
      setEditor({ stage, draft: value, original: JSON.stringify(value) })
    }

    const updateEditor = update => setEditor(current => current ? {
      ...current,
      draft: typeof update === 'function' ? update(current.draft) : { ...current.draft, ...update },
    } : current)

    const saveEditor = async () => {
      if (!editor || editor.stage !== activeStage) return
      if (!editorDirty) return setEditor(null)
      if (!storyDraftValid) return setError('请填写名称和故事，并将目标时长设为 10–600 秒')
      const updates = editor.stage === 'story' ? editor.draft : { [editor.stage]: editor.draft }
      const result = await call('/episode.update', { projectId, episodeId: selectedEpisodeId, updates })
      if (result) {
        setEpisode(result)
        setEditor(null)
        setProjectEpisodes(current => ({ ...current, [projectId]: (current[projectId] || []).map(item => item.id === selectedEpisodeId
          ? { ...item, title: result.episode.title, status: result.state.status, activeStage: result.state.activeStage }
          : item) }))
      }
    }

    const planEpisode = async () => {
      if (editorDirty) return setError('先保存或取消修改')
      if (!storyValid) return setError('故事设置不完整')
      const result = await call('/episode.plan', { projectId, episodeId: selectedEpisodeId })
      if (result) { setEpisode(result); setEditor(null); setActiveStage('script') }
    }

    const start = async () => {
      if (editorDirty) return setError('先保存或取消修改')
      if (!hasPlan) return setError('先完成自动规划')
      const authorizedBefore = Boolean(episode.state.authorizedAt)
      if (!authorizedBefore && !authorized) return setError('需确认内容合规且素材权利清晰')
      const result = await call(authorizedBefore ? '/production.resume' : '/production.start', { projectId, episodeId: selectedEpisodeId, confirmAuthorizedContent: !authorizedBefore })
      if (result) await refresh(true)
    }

    const pause = async () => {
      const result = await call('/production.pause', { projectId, episodeId: selectedEpisodeId })
      if (result) await refresh(true)
    }

    const retry = async taskId => {
      const result = await call('/production.retry', { projectId, episodeId: selectedEpisodeId, taskId })
      if (result) await refresh(true)
    }

    const approve = async () => {
      if (!reviewWatched || !reviewed) return setError('请完整观看当前成片后再确认')
      if (!reviewer.trim()) return setError('请输入审核人标识')
      const result = await call('/review.approve', { projectId, episodeId: selectedEpisodeId, reviewer: reviewer.trim(), confirmHumanReviewPassed: true })
      if (result) await refresh(true)
    }

    const updateDraft = patch => setDraft(value => ({ ...value, ...patch }))

    const renderTask = (task, index) => {
      const url = task.path ? api.mediaUrl(projectId, task.path) : ''
      const [, tone] = statusMeta(task.status)
      const placeholder = ['needs_attention', 'failed'].includes(task.status) ? '生成失败' : task.status === 'running' ? '生成中' : '等待生成'
      return h('article', { className: `ely-artifact is-${task.type} is-${tone}${url ? '' : ' is-empty'}`, key: task.id },
        h('div', { className: 'ely-artifact-preview' },
          url && !['chapter', 'final', 'audio'].includes(task.type) ? h('img', { src: url, alt: task.entityId }) : null,
          url && ['chapter', 'final', 'audio'].includes(task.type) ? h('video', { src: url, controls: true, preload: 'metadata' }) : null,
          !url ? h('div', { className: 'ely-artifact-placeholder' }, h('span', null, placeholder)) : null,
          h('span', { className: 'ely-artifact-number' }, String(index + 1).padStart(2, '0')),
        ),
        h('div', { className: 'ely-artifact-body' },
          h('div', { className: 'ely-artifact-title' }, h('div', null, h('strong', null, taskLabel(task)), h('small', null, task.entityId)), h(StatusPill, { status: task.status })),
          task.error ? h('p', { className: 'ely-task-error' }, task.error) : null,
          ['needs_attention', 'failed'].includes(task.status) ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => retry(task.id) }, '重新生成') : null,
        ),
      )
    }

    const renderCreateEpisode = () => h('section', { className: 'ely-create' },
      h('header', { className: 'ely-create-head' }, h('div', null, h('h1', null, '新建单集')),
        h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => selectProject(projectId) }, '返回')),
      h('div', { className: 'ely-create-form' },
        h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', maxLength: 120, placeholder: '例如：雨夜来客', value: draft.title, onChange: event => updateDraft({ title: event.target.value }) })),
        h(Field, { label: '故事内容' }, h('textarea', { className: 'tf-textarea ely-story-input', maxLength: 20000, placeholder: '开场、冲突、结尾', value: draft.sourceText, onChange: event => updateDraft({ sourceText: event.target.value }) })),
        h('div', { className: 'ely-form-row' },
          h(Field, { label: '目标时长', hint: '10–600 秒' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', type: 'number', min: 10, max: 600, value: draft.targetDurationSec, onChange: event => updateDraft({ targetDurationSec: Number(event.target.value) }) }), h('span', null, '秒'))),
          h(Field, { label: '画幅' }, h('select', { className: 'tf-input', value: draft.aspectRatio, onChange: event => updateDraft({ aspectRatio: event.target.value }) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
        ),
        h(Field, { label: '生成质量', hint: draft.profile === 'final' ? '耗时与成本更高' : null }, h('select', { className: 'tf-input', value: draft.profile, onChange: event => updateDraft({ profile: event.target.value }) }, h('option', { value: 'preview' }, '预览'), h('option', { value: 'final' }, '正式'))),
        h('details', { className: 'ely-advanced' }, h('summary', null, '视觉设定（选填）'),
          h(Field, { label: '人物统一设定' }, h('input', { className: 'tf-input', maxLength: 2000, placeholder: '主角的外观、服装和气质', value: draft.castPrompt, onChange: event => updateDraft({ castPrompt: event.target.value }) })),
          h(Field, { label: '画面风格' }, h('input', { className: 'tf-input', maxLength: 2000, placeholder: '电影感、色调、光线与镜头语言', value: draft.stylePrompt, onChange: event => updateDraft({ stylePrompt: event.target.value }) }))),
        h('div', { className: 'ely-create-actions' },
          h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !draftValid, title: !draft.title.trim() || !draft.sourceText.trim() ? '请填写单集名称和故事内容' : !draftValid ? '目标时长必须在 10–600 秒之间' : '保存单集', onClick: createEpisode }, busy ? '保存中…' : '保存单集')),
      ),
    )

    const renderStageContent = () => {
      const stage = currentStage
      let body
      if (activeStage === 'story') {
        const value = editor?.stage === 'story' ? editor.draft : episode.episode
        body = editor?.stage === 'story' ? h('div', { className: 'ely-editor' },
          hasPlan ? h('div', { className: 'ely-inline-notice' }, '保存后将更新规划，并重置受影响的后续产物') : null,
          h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', maxLength: 120, value: value.title, onChange: event => updateEditor({ title: event.target.value }) })),
          h(Field, { label: '故事内容' }, h('textarea', { className: 'tf-textarea ely-story-input', maxLength: 20000, value: value.sourceText, onChange: event => updateEditor({ sourceText: event.target.value }) })),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '目标时长', hint: '10–600 秒' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', type: 'number', min: 10, max: 600, value: value.targetDurationSec, onChange: event => updateEditor({ targetDurationSec: Number(event.target.value) }) }), h('span', null, '秒'))),
            h(Field, { label: '画幅' }, h('select', { className: 'tf-input', value: value.aspectRatio, onChange: event => updateEditor({ aspectRatio: event.target.value }) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
          ),
          h(Field, { label: '生成质量' }, h('select', { className: 'tf-input', value: value.profile, onChange: event => updateEditor({ profile: event.target.value }) }, h('option', { value: 'preview' }, '预览'), h('option', { value: 'final' }, '正式'))),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '人物统一设定' }, h('input', { className: 'tf-input', value: value.castPrompt, placeholder: '人物外观、服装和气质', onChange: event => updateEditor({ castPrompt: event.target.value }) })),
            h(Field, { label: '画面风格' }, h('input', { className: 'tf-input', value: value.stylePrompt, placeholder: '色调、光线与镜头语言', onChange: event => updateEditor({ stylePrompt: event.target.value }) })),
          ),
        ) : h('div', { className: 'ely-document ely-story-document' },
          storyLocked ? h('div', { className: 'ely-inline-notice' }, '生产中；暂停后可修改') : null,
          h('blockquote', null, value.sourceText),
          value.castPrompt || value.stylePrompt ? h('dl', { className: 'ely-story-settings' },
            value.castPrompt ? h(React.Fragment, null, h('dt', null, '人物设定'), h('dd', null, value.castPrompt)) : null,
            value.stylePrompt ? h(React.Fragment, null, h('dt', null, '画面风格'), h('dd', null, value.stylePrompt)) : null,
          ) : null)
      } else if (activeStage === 'script') {
        const value = editor?.stage === 'script' ? editor.draft : episode.script
        body = editor?.stage === 'script' ? h('div', { className: 'ely-editor ely-script-editor' },
          h(Field, { label: '故事梗概' }, h('textarea', { className: 'tf-textarea ely-script-synopsis-input', maxLength: 20000, value: value?.synopsis || '', onChange: event => updateEditor({ synopsis: event.target.value }) })),
          h('div', { className: 'ely-edit-list' }, (value?.scenes || []).map((scene, index) => h('section', { key: scene.id },
            h('strong', null, `场景 ${String(index + 1).padStart(2, '0')}`),
            h(Field, { label: '标题' }, h('input', { className: 'tf-input', maxLength: 120, value: scene.title || '', onChange: event => updateEditor(current => ({ ...current, scenes: current.scenes.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })) })),
            h(Field, { label: '内容' }, h('textarea', { className: 'tf-textarea', maxLength: 20000, value: scene.summary || '', onChange: event => updateEditor(current => ({ ...current, scenes: current.scenes.map((item, itemIndex) => itemIndex === index ? { ...item, summary: event.target.value } : item) })) })),
          )))
        ) : h('div', { className: 'ely-document' },
          storyLocked ? h('div', { className: 'ely-inline-notice' }, '生产中；暂停后可修改') : null,
          h('blockquote', null, value?.synopsis || episode.episode.sourceText),
          h('div', { className: 'ely-scene-list' }, (value?.scenes || []).map((scene, index) => h('article', { key: scene.id }, h('span', null, String(index + 1).padStart(2, '0')), h('div', null, h('h3', null, scene.title), h('p', null, scene.summary))))))
      } else if (activeStage === 'assets') {
        body = h('div', { className: 'ely-assets' }, (episode.assets || []).length ? episode.assets.map(asset => {
          const task = episode.tasks.find(item => item.id === `asset:${asset.id}`)
          return h('article', { className: 'ely-asset-card', key: asset.id }, task ? renderTask(task, 0) : null,
            h('div', null, h('h3', null, asset.name), h('p', null, asset.prompt)))
        }) : h('div', { className: 'ely-empty-state' }, h('strong', null, '暂无独立资产')))
      } else if (activeStage === 'plan') {
        const value = editor?.stage === 'plan' ? editor.draft : episode.plan
        body = editor?.stage === 'plan' ? h('div', { className: 'ely-editor ely-plan-editor' },
          h('div', { className: 'ely-inline-notice' }, '保存后将重置受影响的画面、章节与成片'),
          h('div', { className: 'ely-edit-list' }, value.chapters.map((chapter, chapterIndex) => h('section', { key: chapter.id },
            h('strong', null, `章节 ${String(chapterIndex + 1).padStart(2, '0')}`),
            h(Field, { label: '标题' }, h('input', { className: 'tf-input', maxLength: 120, value: chapter.title || '', onChange: event => updateEditor(current => ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === chapterIndex ? { ...item, title: event.target.value } : item) })) })),
            h(Field, { label: '内容' }, h('textarea', { className: 'tf-textarea', maxLength: 20000, value: chapter.summary || '', onChange: event => updateEditor(current => ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === chapterIndex ? { ...item, summary: event.target.value } : item) })) })),
            h(Field, { label: '环境音与拟音（英文）' }, h('textarea', { className: 'tf-textarea', maxLength: 2000, value: chapter.soundPrompt || '', onChange: event => updateEditor(current => ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === chapterIndex ? { ...item, soundPrompt: event.target.value } : item) })) })),
            h('div', { className: 'ely-anchor-edit-list' }, chapter.anchors.map((anchor, anchorIndex) => h('div', { key: anchor.id },
              h('span', null, String(anchorIndex + 1).padStart(2, '0')),
              h(Field, { label: '画面' }, h('textarea', { className: 'tf-textarea', value: anchor.imagePrompt || '', onChange: event => updateEditor(current => ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === chapterIndex ? { ...item, anchors: item.anchors.map((entry, entryIndex) => entryIndex === anchorIndex ? { ...entry, imagePrompt: event.target.value } : entry) } : item) })) })),
              h(Field, { label: '动作与运镜' }, h('textarea', { className: 'tf-textarea', value: anchor.motionPrompt || '', onChange: event => updateEditor(current => ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === chapterIndex ? { ...item, anchors: item.anchors.map((entry, entryIndex) => entryIndex === anchorIndex ? { ...entry, motionPrompt: event.target.value } : entry) } : item) })) })),
            ))),
          )))
        ) : h('div', { className: 'ely-plan' },
          storyLocked ? h('div', { className: 'ely-inline-notice' }, '生产中；暂停后可修改') : null,
          value.source === 'producer-agent' ? null : h('div', { className: 'ely-callout' }, '草稿规划 · 保存故事后自动规划'),
          h('div', { className: 'ely-chapter-list' }, value.chapters.map((chapter, chapterIndex) => h('article', { className: 'ely-chapter', key: chapter.id },
            h('header', null, h('span', null, `章节 ${String(chapterIndex + 1).padStart(2, '0')}`), h('h3', null, chapter.title), h('small', null, `${chapter.anchors.length} 个画面锚点 · ${chapter.soundPrompt ? '音效已规划' : '缺少音效规划'}`)),
            h('div', { className: 'ely-anchor-list' }, chapter.anchors.map((anchor, index) => h('div', { className: 'ely-anchor-row', key: anchor.id },
              h('span', { className: 'ely-anchor-index' }, String(index + 1).padStart(2, '0')),
              h('div', null, h('small', null, index === 0 ? '文生图 · 起始帧' : '图生图 · 连续关键帧'), h('p', null, anchor.imagePrompt)),
            ))),
          ))))
      } else if (activeStage === 'final' && episode.state.final) {
        const finalUrl = api.mediaUrl(projectId, episode.state.final.path)
        body = h('div', { className: 'ely-final' },
          h('div', { className: 'ely-final-player' }, h('video', { src: finalUrl, controls: true, preload: 'metadata', onEnded: () => setReviewWatched(true) })),
          h('div', { className: 'ely-final-meta' }, h('div', null, h('span', null, '技术质检'), h('strong', null, `${episode.state.final.qc?.durationSec || '—'} 秒`), h('small', null, `目标 ${episode.episode.targetDurationSec} 秒 · 音轨 ${episode.state.final.qc?.audioCodec || '缺失'}`)), h(StatusPill, { status: episode.state.status })),
          episode.state.status === 'awaiting_review' ? h('div', { className: 'ely-review' }, h('h3', null, '人工终审'), h('p', null, '完整播放后，确认连续性、人物一致性和内容完整性'),
            h(Field, { label: '审核人' }, h('input', { className: 'tf-input', maxLength: 120, placeholder: '输入审核人标识', value: reviewer, onChange: event => setReviewer(event.target.value) })),
            h('label', { className: `ely-check${reviewWatched ? '' : ' is-disabled'}` }, h('input', { type: 'checkbox', disabled: !reviewWatched, checked: reviewed, onChange: event => setReviewed(event.target.checked) }), h('span', null, reviewWatched ? '确认成片通过' : '完整播放后可确认')),
          ) : null,
          h('div', { className: 'ely-final-actions' }, h('a', { className: 'ely-btn ely-btn-secondary ely-download', href: finalUrl, download: `${episode.episode.title || 'elysium'}.mp4` }, '下载成片')),
        )
      } else {
        const tasks = tasksForStage(episode.tasks, activeStage)
        body = tasks.length ? h('div', { className: 'ely-artifact-grid' }, tasks.map(renderTask)) : h('div', { className: 'ely-empty-state' }, h('strong', null, '暂无产物'))
      }
      const isEditing = editor?.stage === activeStage
      const canEdit = ['story', 'script', 'plan'].includes(activeStage)
      return h('section', { className: 'ely-stage-panel' },
        h('header', { className: 'ely-stage-header' },
          h('div', { className: 'ely-stage-heading' }, h('h2', null, stage.label), isEditing && editorDirty ? h('span', { className: 'ely-stage-unsaved' }, '未保存') : null),
          h('div', { className: 'ely-stage-actions' },
            isEditing ? h(React.Fragment, null,
              h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => setEditor(null) }, '取消'),
              h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !editorDirty || !storyDraftValid, onClick: saveEditor }, busy ? '保存中…' : '保存'),
            ) : h(React.Fragment, null,
              canEdit ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy || storyLocked, title: storyLocked ? '生产中；暂停后可修改' : `编辑${stage.label}`, onClick: () => beginEditing(activeStage) }, '编辑') : null,
              hasPlan && !episode.state.authorizedAt && !['approved', 'awaiting_review'].includes(episode.state.status) ? h('label', { className: 'ely-authorization' }, h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }), h('span', null, h('strong', null, '生产授权'), h('small', null, '内容合规且拥有素材使用权'))) : null,
              h('div', { className: 'ely-primary-action' }, primaryAction()),
            ),
          )),
        totalTasks ? h('section', { className: 'ely-production-summary' },
          h('div', { className: 'ely-summary-metric' }, h('span', null, '任务'), h('strong', null, `${completeTasks}/${totalTasks}`)),
          h('div', { className: 'ely-progress-track' }, h('i', { style: { width: `${progress}%` } })),
          activeTasks ? h('div', { className: 'ely-summary-metric' }, h('span', null, '进行中'), h('strong', null, activeTasks)) : null,
          openIssues.length ? h('div', { className: 'ely-summary-metric is-danger' }, h('span', null, '待处理'), h('strong', null, openIssues.length)) : null,
        ) : null,
        openIssues.length ? h('section', { className: 'ely-attention' }, h('header', null, h('div', null, h('span', null, '!'), h('strong', null, `${openIssues.length} 项需要处理`))), openIssues.map(issue => h('article', { key: issue.id }, h('div', null, h('strong', null, issue.code), h('p', null, issue.message)), h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => retry(issue.taskId) }, '重试')))) : null,
        body)
    }

    const primaryAction = () => {
      if (episode.state.status === 'running') return h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: pause }, '暂停生产')
      if (episode.state.status === 'needs_attention') return null
      if (episode.state.status === 'awaiting_review') return activeStage === 'final'
        ? h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !reviewer.trim() || !reviewWatched || !reviewed, title: !reviewWatched ? '需完整播放成片' : !reviewer.trim() ? '需填写审核人' : !reviewed ? '需确认终审结果' : '提交终审', onClick: approve }, busy ? '提交中…' : '通过终审')
        : h('button', { className: 'ely-btn ely-btn-primary', onClick: () => setActiveStage('final') }, '前往终审')
      if (episode.state.status === 'approved') return activeStage === 'final'
        ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: true }, '本集已完成')
        : h('button', { className: 'ely-btn ely-btn-secondary', onClick: () => setActiveStage('final') }, '查看成片')
      if (!hasPlan) return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || storyLocked || !storyValid, title: !storyValid ? '名称、故事或时长无效' : '生成规划', onClick: planEpisode }, busy ? '规划中…' : '自动规划')
      return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || editorDirty || (!episode.state.authorizedAt && !authorized), title: editorDirty ? '需先保存或取消修改' : '', onClick: start }, busy ? '处理中…' : episode.state.status === 'paused' ? '继续生产' : '开始生产')
    }

    const renderBulkBar = () => selectedProjectIds.length ? h('section', { className: 'ely-hub-batch' },
      h('div', null, h('strong', null, `已选择 ${selectedProjectIds.length} 项`)),
      h('label', null, h('input', { type: 'checkbox', checked: batchAuthorized, disabled: !batchStartCount, onChange: event => setBatchAuthorized(event.target.checked) }), h('span', null, batchStartCount ? `确认 ${batchStartCount} 个单集内容及素材已获授权` : '没有可启动的单集')),
      h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || editorDirty || draftDirty || !batchAuthorized || !batchStartCount, onClick: () => void runBulk('start') }, `启动 / 继续 (${batchStartCount})`),
      h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy || editorDirty || draftDirty || !batchPauseCount, onClick: () => void runBulk('pause') }, `暂停 (${batchPauseCount})`),
    ) : null

    const renderCreativeCreate = () => {
      const selected = directors.find(item => item.id === creativeDraft.directorId)
      return h('section', { className: 'ely-create ely-creative-create' },
        h('button', { className: 'ely-back-link', onClick: () => openOverview('all') }, '‹ 返回总览'),
        h('header', { className: 'ely-create-head' }, h('div', null,
          h('span', { className: 'ely-kicker' }, '导演人格 + DeepSeek + Skill'),
          h('h1', null, '创建创新项目'),
          h('p', null, '选择固定导演流派，由对话逐步完成剧情，再由你明确确认后进入制作。'))),
        h('div', { className: 'ely-create-form' },
          h(Field, { label: '项目名称' }, h('input', {
            className: 'tf-input', type: 'text', autoFocus: true, maxLength: 120, value: creativeDraft.title,
            placeholder: '例如：雾港来信', onChange: event => setCreativeDraft(current => ({ ...current, title: event.target.value })),
          })),
          h('fieldset', { className: 'ely-director-picker' },
            h('legend', null, '选择导演'),
            directors.length ? directors.map(director => h('label', { key: director.id, className: creativeDraft.directorId === director.id ? 'is-selected' : '' },
              h('input', { type: 'radio', name: 'director', value: director.id, checked: creativeDraft.directorId === director.id, onChange: () => setCreativeDraft(current => ({ ...current, directorId: director.id })) }),
              h('span', null, h('strong', null, director.schoolName), h('small', null, director.inspiredBy)),
              h('p', null, director.summary),
              h('div', null, ...(director.styleTags || []).map(tag => h('em', { key: tag }, tag))),
            )) : h('div', { className: 'ely-hub-empty' }, '正在读取导演配置…')),
          selected ? h('aside', { className: 'ely-director-notice' }, h('strong', null, '风格说明'), h('p', null, selected.disclaimer)) : null,
          h('div', { className: 'ely-create-actions' }, h('button', {
            className: 'ely-btn ely-btn-primary', disabled: busy || !creativeDraft.title.trim() || !selected,
            onClick: createCreativeProject,
          }, busy ? '正在创建…' : '创建并进入创作')),
        ),
      )
    }

    const renderCreativeProject = () => {
      const creation = creationState?.creation
      const draftStory = creation?.storyDraft
      const completed = creation?.steps?.filter(step => step.status === 'confirmed').length || 0
      const canApprove = creation?.status === 'awaiting_story_approval'
      const canSync = creation?.status === 'story_approved'
      const ready = creation?.status === 'production_ready'
      return h('section', { className: 'ely-project-detail ely-creative-project' },
        h('button', { className: 'ely-back-link', onClick: () => openOverview('all') }, '‹ 返回总览'),
        h('header', { className: 'ely-project-detail-head' }, h('div', null,
          h('span', { className: 'ely-kicker' }, '创新项目'),
          h('h1', { title: selectedProject?.title }, selectedProject?.title || '未命名'),
          h('p', null, creationLoading && !creation ? '正在读取创作状态…' : `${creationState?.director?.schoolName || '导演'} · ${CREATION_STATUS[creation?.status] || creation?.status || '待恢复'}`)),
          h('div', null,
            h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy || !creationState, onClick: openCreativeConversation }, creation?.conversationId ? '打开创作会话' : '创建创作会话'),
            h('button', { className: 'ely-btn ely-btn-secondary', title: `删除 ${selectedProject?.title || ''}`, onClick: () => setProjectToDelete(selectedProject) }, '删除'))),
        creation ? h('section', { className: 'ely-creation-progress' },
          h('div', null, h('strong', null, `第 ${creation.currentStep}/15 步`), h('span', null, `${completed}/15 已确认`)),
          h('div', { className: 'ely-progress-track' }, h('i', { style: { width: `${Math.round((completed / 15) * 100)}%` } })),
          h('ol', null, ...(creation.steps || []).map(step => h('li', { key: step.index, className: `is-${step.status}` }, h('span', null, step.index), h('strong', null, step.label), h('small', null, step.status === 'confirmed' ? '已确认' : step.status === 'draft' ? '待确认' : '未开始')))),
        ) : null,
        draftStory ? h('section', { className: 'ely-story-preview' },
          h('header', null, h('div', null, h('span', null, '结构化剧情预览'), h('h2', null, draftStory.logline || selectedProject.title)),
            h('small', null, `版本 ${creation.storyVersion} · ${draftStory.durationSec} 秒 · ${draftStory.chapterCount} 章`)),
          h('p', null, draftStory.synopsis),
          h('dl', null,
            h('dt', null, '角色'), h('dd', null, (draftStory.characters || []).map(item => `${item.name}（${item.age}岁）`).join('、')),
            h('dt', null, '场景'), h('dd', null, (draftStory.scenes || []).map(item => item.title).join('、')),
            h('dt', null, '导演备注'), h('dd', null, draftStory.directorNotes || '—')),
          h('div', { className: 'ely-story-preview-actions' },
            (canApprove || canSync) ? h('button', { className: 'ely-btn ely-btn-primary', disabled: busy, onClick: approveAndSyncStory }, busy ? '正在写入…' : canApprove ? '确认剧情并进入制作' : '重试写入制作流程') : null,
            ready && creation.sync?.episodeId ? h('button', { className: 'ely-btn ely-btn-primary', onClick: () => chooseEpisode(projectId, creation.sync.episodeId) }, '进入制作流程') : null,
            creation.approval ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: reopenCreativeStory }, '退回剧情创作') : null),
        ) : h('section', { className: 'ely-creative-empty' }, h('strong', null, '在 DeepSeek 会话中逐步创作'), h('p', null, '每一步都会保存到项目；刷新页面或 Harness 重启后可继续。'), h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !creationState, onClick: openCreativeConversation }, creation?.conversationId ? '继续创作' : '创建会话并开始')),
      )
    }

    const renderOverview = () => {
      const visibleIds = visibleProjectRows.map(row => row.project.id)
      const allVisibleSelected = visibleIds.length && visibleIds.every(id => selectedProjectIds.includes(id))
      const queueLabel = projectView === 'running' ? '生产中队列' : '待处理队列'
      return h('section', { className: 'ely-hub' },
        h('header', { className: 'ely-hub-head' }, h('div', null, h('h1', null, '总览')),
          h('div', { className: 'ely-new-actions' },
            h('button', { className: 'ely-btn ely-btn-secondary', onClick: () => setShowProjectForm(true) }, '普通项目'),
            h('button', { className: 'ely-btn ely-btn-primary', onClick: () => navigateSafely('创建创新项目', () => { setProjectId(''); setWorkspaceView('creative-create') }) }, '创新项目'))),
        h('input', { className: 'tf-input ely-hub-search', type: 'search', value: projectQuery, placeholder: '搜索名称或单集', 'aria-label': '搜索名称或单集', onChange: event => setProjectQuery(event.target.value) }),
        projectView !== 'all' && projectView !== 'done'
          ? h('div', { className: 'ely-queue' },
            h('div', { className: 'ely-list-heading' }, h('strong', null, queueLabel), h('span', null, `${queueEpisodes.length} 个单集`),
              projectView === 'attention' ? h('nav', { className: 'ely-queue-tabs', 'aria-label': '待处理类型' }, [['all', '全部'], ['failed', '失败'], ['review', '待审核']].map(([key, label]) => h('button', { key, className: attentionQueue === key ? 'is-active' : '', onClick: () => setAttentionQueue(key) }, label))) : null),
            queueEpisodes.length ? queueEpisodes.map(({ project, episode: item }) => h('button', { key: `${project.id}:${item.id}`, className: 'ely-queue-row', onClick: () => chooseEpisode(project.id, item.id) },
              h('span', { className: 'ely-queue-context', title: project.title }, project.title), h('strong', { title: item.title }, item.title), h(StatusPill, { status: item.status }), h('span', { className: 'ely-row-arrow' }, '›'))) : h('div', { className: 'ely-hub-empty' }, '暂无任务'))
          : h('div', { className: 'ely-project-table' },
            h('div', { className: 'ely-list-heading' }, h('strong', null, projectView === 'done' ? '已完成' : '全部'), h('span', null, `${visibleProjectRows.length} 项`),
              visibleIds.length ? h('button', { className: 'ely-select-visible', onClick: () => toggleAllProjects(visibleIds) }, allVisibleSelected ? '取消全选' : '选择当前结果') : null),
            visibleProjectRows.length ? visibleProjectRows.map(({ project, summary }) => h('article', { className: 'ely-project-table-row', key: project.id },
              h('input', { type: 'checkbox', 'aria-label': `选择 ${project.title}`, checked: selectedProjectIds.includes(project.id), onChange: () => toggleProject(project.id) }),
              h('button', { className: 'ely-project-cell', title: project.title, onClick: () => selectProject(project.id) }, h('strong', null, project.title), h('span', null, `${summary.done}/${summary.total} 集已完成`)),
              h('div', { className: 'ely-project-signals' }, summary.running ? h('span', { className: 'is-running' }, `${summary.running} 生产中`) : null, summary.failed ? h('span', { className: 'is-danger' }, `${summary.failed} 失败`) : null, summary.review ? h('span', { className: 'is-review' }, `${summary.review} 待审核`) : null, !summary.running && !summary.failed && !summary.review ? h('span', null, summary.total ? `${summary.total - summary.done} 待推进` : '暂无单集') : null))
            )
              : h('div', { className: 'ely-hub-empty' }, normalizedProjectQuery ? '没有匹配结果' : '暂无内容')),
        renderBulkBar(),
      )
    }

    const renderProject = () => {
      if (selectedProject?.kind === 'creative') return renderCreativeProject()
      const summary = projectProductionSummary(currentEpisodes)
      return h('section', { className: 'ely-project-detail' },
        h('button', { className: 'ely-back-link', onClick: () => openOverview('all') }, '‹ 返回总览'),
        h('header', { className: 'ely-project-detail-head' }, h('div', null, h('h1', { title: selectedProject?.title }, selectedProject?.title || '未命名'), h('p', null, projectSummaryText(summary))),
          h('div', null, h('button', { className: 'ely-btn ely-btn-secondary', title: `删除 ${selectedProject?.title || ''}`, onClick: () => setProjectToDelete(selectedProject) }, '删除'), h('button', { className: 'ely-btn ely-btn-primary', onClick: () => createEpisodeIn(projectId) }, '新建单集'))),
        h('div', { className: 'ely-hub-controls' },
          h('input', { className: 'tf-input ely-hub-search', type: 'search', value: episodeQuery, placeholder: '搜索单集', 'aria-label': '搜索单集', onChange: event => setEpisodeQuery(event.target.value) }),
          h('nav', { className: 'ely-hub-filters', 'aria-label': '单集状态筛选' }, PROJECT_VIEWS.map(([key, label]) => h('button', { key, className: episodeView === key ? 'is-active' : '', onClick: () => setEpisodeView(key) }, h('span', null, label), h('strong', null, currentEpisodes.filter(item => matchesView(item.status, key)).length)))),
        ),
        h('div', { className: 'ely-episode-table' },
          h('div', { className: 'ely-list-heading' }, h('strong', null, '单集列表'), h('span', null, `${filteredEpisodes.length} 集${episodePages > 1 ? ` · 第 ${episodePage}/${episodePages} 页` : ''}`)),
          pagedEpisodes.length ? pagedEpisodes.map(item => h('button', { className: 'ely-episode-table-row', key: item.id, onClick: () => chooseEpisode(projectId, item.id) },
            h('span', { className: 'ely-episode-number' }, String(currentEpisodes.indexOf(item) + 1).padStart(2, '0')), h('strong', { title: item.title }, item.title), h(StatusPill, { status: item.status }), h('span', { className: 'ely-row-arrow' }, '›'))) : h('div', { className: 'ely-hub-empty' }, currentEpisodes.length ? '没有匹配的单集' : '暂无单集'),
          episodePages > 1 ? h('div', { className: 'ely-pagination' }, h('button', { className: 'ely-btn ely-btn-secondary', disabled: episodePage <= 1, onClick: () => setEpisodePage(page => page - 1) }, '上一页'), h('span', null, `${episodePage} / ${episodePages}`), h('button', { className: 'ely-btn ely-btn-secondary', disabled: episodePage >= episodePages, onClick: () => setEpisodePage(page => page + 1) }, '下一页')) : null,
        ),
      )
    }

    return h('div', { className: 'ely-studio' },
      h('aside', { className: `ely-library${projectId ? ' is-contextual' : ''}` },
        h('div', { className: 'ely-library-head' }, h('span', null, '总览'), h('button', { title: showProjectForm ? '收起' : '新建', 'aria-label': showProjectForm ? '收起' : '新建', 'aria-expanded': showProjectForm, onClick: () => setShowProjectForm(value => !value) }, showProjectForm ? '−' : '+')),
        showProjectForm ? h('div', { className: 'ely-project-create' }, h('input', { className: 'tf-input', autoFocus: true, maxLength: 120, placeholder: '名称', value: projectTitle, onChange: event => setProjectTitle(event.target.value), onKeyDown: event => { if (event.key === 'Enter' && projectTitle.trim()) navigateSafely('创建并切换', createProject) } }), h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !projectTitle.trim(), title: projectTitle.trim() ? '创建' : '请输入名称', onClick: () => navigateSafely('创建并切换', createProject) }, busy ? '创建中…' : '创建')) : null,
        projectsLoading ? h('div', { className: 'ely-library-empty', role: 'status' }, '正在加载…') : h(React.Fragment, null,
          h('nav', { className: 'ely-library-nav', 'aria-label': '视图' }, PROJECT_VIEWS.map(([key, label]) => h('button', { key, className: workspaceView === 'overview' && projectView === key ? 'is-active' : '', onClick: () => openOverview(key) }, h('span', null, label), h('strong', null, viewCounts[key])))),
          projectId && selectedProject ? h('div', { className: 'ely-current-project' }, h('button', { title: selectedProject.title, onClick: () => selectProject(projectId) }, h('strong', null, selectedProject.title), h('small', null, `${currentEpisodes.length} 集`))) : null,
          !projects.length ? h('div', { className: 'ely-library-empty' }, '暂无内容') : null)),
      h('main', { className: 'ely-workspace' },
        (error || message) && !episode ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}`, role: error ? 'alert' : 'status' }, h('span', null, error || message), h('button', { 'aria-label': '关闭提示', onClick: () => { setError(''); setMessage('') } }, '×')) : null,
        projectsLoading || (episodeLoading && workspaceView === 'episode') ? h('section', { className: 'ely-zero', role: 'status' }, h('span', { className: 'ely-loading-ring' }), h('h1', null, '正在打开'))
          : workspaceView === 'creative-create' ? renderCreativeCreate()
            : workspaceView === 'overview' || !projectId ? renderOverview()
            : workspaceView === 'project' ? renderProject()
              : workspaceView === 'create' ? renderCreateEpisode()
                : !episode ? renderProject()
            : h('div', { className: 'ely-production' },
              h('header', { className: 'ely-production-head' },
                h('div', { className: 'ely-production-title' }, h('button', { className: 'ely-breadcrumb', title: `返回 ${selectedProject?.title || ''}`, onClick: () => selectProject(projectId) }, '‹ 返回'), h('h1', { title: episode.episode.title }, episode.episode.title), h('div', { className: 'ely-production-meta' }, h(StatusPill, { status: episode.state.status }), h('span', null, `${episode.episode.targetDurationSec} 秒`), h('span', null, episode.episode.profile === 'final' ? '正式' : '预览'))),
                h('button', { className: 'ely-head-refresh', disabled: busy || !!editor, onClick: () => refresh(false), title: editor ? '请先保存或取消修改' : '刷新生产状态' }, busy ? '更新中…' : '刷新')),
              (error || message) ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}`, role: error ? 'alert' : 'status' }, h('span', null, error || message), h('button', { 'aria-label': '关闭提示', onClick: () => { setError(''); setMessage('') } }, '×')) : null,
              h('nav', { className: 'ely-stage-track', 'aria-label': '制作流程' },
                h('div', { className: 'ely-stage-track-title' }, h('strong', null, '制作流程'), h('span', null, `${completedStageCount}/8`)),
                h('div', { className: 'ely-stage-steps' }, STAGES.map((stage, index) => { const state = stageState(episode, stage.key, index); return h('button', { key: stage.key, className: `${stage.key === activeStage ? 'is-active ' : ''}is-${state}`, 'aria-current': stage.key === activeStage ? 'step' : undefined, onClick: () => navigateSafely('切换阶段', () => { setEditor(null); setActiveStage(stage.key) }) }, h('span', null, state === 'complete' ? '✓' : stage.short), h('strong', null, stage.label)) }))),
              h('div', { className: 'ely-stage-content' }, renderStageContent())),
        projectToDelete ? h(ConfirmDialog, {
          title: '确认删除',
          message: `确定删除“${projectToDelete.title}”吗？其中全部单集与产物也会被删除，且无法恢复。`,
          busy,
          onClose: () => setProjectToDelete(null),
          onConfirm: deleteProject,
        }) : null,
        pendingNavigation ? Modal(h, {
          title: '放弃未保存修改？',
          onClose: () => setPendingNavigation(null),
          children: h('p', { className: 'tf-confirm-message' }, `当前内容尚未保存。继续${pendingNavigation.label}将丢失这些修改。`),
          actions: [
            h('button', { key: 'cancel', type: 'button', className: 'tf-btn tf-btn-ghost', onClick: () => setPendingNavigation(null) }, '继续编辑'),
            h('button', { key: 'discard', type: 'button', className: 'tf-btn tf-btn-danger-solid', onClick: discardAndNavigate }, '放弃并继续'),
          ],
        }) : null,
    ))
  }
}
