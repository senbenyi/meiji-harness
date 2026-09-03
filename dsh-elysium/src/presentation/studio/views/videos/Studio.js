import { createConfirmDialog, Modal } from '../../components/Modal.js'

const EMPTY_DRAFT = { title: '', sourceText: '', targetDurationSec: 10, aspectRatio: '9:16', profile: 'preview', budget: '', stylePrompt: '', castPrompt: '' }

const STAGES = [
  { key: 'story', label: '故事', short: '01', hint: '确定内容与生产规格' },
  { key: 'script', label: '剧本', short: '02', hint: '查看场景拆解' },
  { key: 'assets', label: '资产', short: '03', hint: '锁定人物视觉' },
  { key: 'plan', label: '规划', short: '04', hint: '确认章节与锚点' },
  { key: 'start_frame', label: '起始帧', short: '05', hint: '生成每章第一帧' },
  { key: 'keyframes', label: '关键帧', short: '06', hint: '延展连续画面' },
  { key: 'chapters', label: '章节', short: '07', hint: '生成长视频章节' },
  { key: 'final', label: '成片', short: '08', hint: '合成与人工终审' },
]

const STATUS = {
  draft: ['草稿', 'neutral'], queued: ['排队中', 'working'], running: ['生产中', 'working'],
  paused: ['已暂停', 'neutral'], needs_attention: ['需要处理', 'danger'], awaiting_review: ['等待终审', 'review'],
  approved: ['已完成', 'success'], ready: ['准备就绪', 'neutral'], pending: ['未开始', 'neutral'], succeeded: ['已完成', 'success'], failed: ['失败', 'danger'],
}

function makeEpisodeId() { return `episode-${Date.now().toString(36)}` }
function storyFingerprint(value = {}) {
  return JSON.stringify({
    title: value.title || '', sourceText: value.sourceText || '', targetDurationSec: Number(value.targetDurationSec || 0),
    aspectRatio: value.aspectRatio || '9:16', profile: value.profile || 'preview', stylePrompt: value.stylePrompt || '', castPrompt: value.castPrompt || '',
  })
}
function statusMeta(status) { return STATUS[status] || [status || '未知', 'neutral'] }
function visibleStage(stage) { return STAGES.some(item => item.key === stage) ? stage : ['review', 'approved'].includes(stage) ? 'final' : 'story' }
function taskLabel(task) {
  return ({ asset: '人物定妆', start_frame: '章节起始帧', keyframe: '连续关键帧', chapter: '长视频章节', final: '最终成片' })[task.type] || task.type
}
function tasksForStage(tasks, stage) {
  const type = { start_frame: 'start_frame', keyframes: 'keyframe', chapters: 'chapter', final: 'final' }[stage]
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

  return function Studio({ initialProjectId, initialEpisodeId, onSelection, onDirty, onBusy }) {
    const [projects, setProjects] = useState([])
    const [projectsLoading, setProjectsLoading] = useState(true)
    const [episodeLoading, setEpisodeLoading] = useState(false)
    const [projectId, setProjectId] = useState(initialProjectId || '')
    const [episodeIdToOpen, setEpisodeIdToOpen] = useState(initialEpisodeId || '')
    const [selectedProjectIds, setSelectedProjectIds] = useState([])
    const [openProjectIds, setOpenProjectIds] = useState(initialProjectId ? [initialProjectId] : [])
    const [batchAuthorized, setBatchAuthorized] = useState(false)
    const [projectEpisodes, setProjectEpisodes] = useState({})
    const [episode, setEpisode] = useState(null)
    const [savedStory, setSavedStory] = useState('')
    const [activeStage, setActiveStage] = useState('story')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [authorized, setAuthorized] = useState(false)
    const [reviewed, setReviewed] = useState(false)
    const [reviewWatched, setReviewWatched] = useState(false)
    const [reviewer, setReviewer] = useState('')
    const [showProjectForm, setShowProjectForm] = useState(false)
    const [projectTitle, setProjectTitle] = useState('')
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
    const storyDirty = !!episode && !!savedStory && storyFingerprint(episode.episode) !== savedStory
    const draftDirty = storyFingerprint(draft) !== storyFingerprint(EMPTY_DRAFT)
    const storyValid = !!episode?.episode?.title.trim() && !!episode?.episode?.sourceText.trim() && Number(episode?.episode?.targetDurationSec) >= 10 && Number(episode?.episode?.targetDurationSec) <= 600
    const draftValid = !!draft.title.trim() && !!draft.sourceText.trim() && Number(draft.targetDurationSec) >= 10 && Number(draft.targetDurationSec) <= 600
    const hasPlan = episode?.plan?.source !== 'auto-draft' && !!episode?.script?.scenes?.length && !!episode?.plan?.chapters?.length
    const storyLocked = ['running', 'queued'].includes(episode?.state?.status)
    const selectedEpisodes = selectedProjectIds.flatMap(id => projectEpisodes[id] || [])
    const batchStartCount = selectedEpisodes.filter(item => ['ready', 'paused'].includes(item.status)).length
    const batchPauseCount = selectedEpisodes.filter(item => ['running', 'queued'].includes(item.status)).length
    const currentStage = STAGES.find(item => item.key === activeStage) || STAGES[0]
    const completedStageCount = episode ? STAGES.filter((stage, index) => stageState(episode, stage.key, index) === 'complete').length : 0

    useEffect(() => { onDirty?.(storyDirty || draftDirty) }, [storyDirty, draftDirty, onDirty])
    useEffect(() => { onBusy?.(busy); return () => onBusy?.(false) }, [busy, onBusy])
    useEffect(() => { setReviewWatched(false); setReviewed(false) }, [episode?.state?.final?.path])

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
      if (!projectId && nextProjects.length) {
        setProjectId(nextProjects[0].id)
        setOpenProjectIds(current => current.includes(nextProjects[0].id) ? current : [...current, nextProjects[0].id])
      }
      setProjectsLoading(false)
    }, [call, projectId])

    const loadEpisodes = useCallback(async (id = projectId) => {
      if (!id) { setEpisode(null); setEpisodeLoading(false); return }
      setEpisodeLoading(true)
      const result = await call('/episode.list', { projectId: id }, true)
      if (!result) { setEpisodeLoading(false); return }
      const ordered = episodesInCreationOrder(result.episodes)
      setProjectEpisodes(current => ({ ...current, [id]: ordered }))
      const wanted = episodeIdToOpen || (episode?.episode?.projectId === id ? episode.episode.id : '')
      const next = ordered.find(item => item.id === wanted) || ordered[0]
      if (!next) { setEpisode(null); setSavedStory(''); setEpisodeLoading(false); return }
      const detail = await call('/episode.get', { projectId: id, episodeId: next.id }, true)
      if (detail) { setEpisode(detail); setSavedStory(storyFingerprint(detail.episode)); setActiveStage(visibleStage(detail.state?.activeStage)) }
      setEpisodeLoading(false)
    }, [call, projectId, episodeIdToOpen, episode?.episode?.id, episode?.episode?.projectId])

    const refresh = useCallback(async (quiet = true) => {
      if (!projectId || !selectedEpisodeId) return
      const result = await call('/production.status', { projectId, episodeId: selectedEpisodeId }, quiet)
      if (result) {
        setEpisode(result)
        setSavedStory(storyFingerprint(result.episode))
        setProjectEpisodes(current => ({ ...current, [projectId]: (current[projectId] || []).map(item => item.id === selectedEpisodeId
          ? { ...item, title: result.episode.title, status: result.state.status, activeStage: result.state.activeStage }
          : item) }))
      }
    }, [call, projectId, selectedEpisodeId])

    useEffect(() => { void loadProjects() }, [])
    useEffect(() => { void loadEpisodes(projectId) }, [projectId, episodeIdToOpen])
    useEffect(() => { onSelection?.(projectId || null, selectedEpisodeId || null) }, [projectId, selectedEpisodeId, onSelection])
    useEffect(() => {
      if (!['running', 'queued'].includes(episode?.state?.status)) return undefined
      const timer = window.setInterval(() => void refresh(true), 2500)
      return () => window.clearInterval(timer)
    }, [episode?.state?.status, refresh])

    const createProject = async () => {
      if (!projectTitle.trim()) return setError('请输入项目名称')
      const result = await call('/project.create', { title: projectTitle.trim() })
      if (!result) return
      setProjectTitle(''); setShowProjectForm(false); await loadProjects(); setProjectId(result.project.id); setOpenProjectIds(current => [...new Set([...current, result.project.id])]); setEpisodeIdToOpen(''); setEpisode(null)
      setMessage('项目已创建，现在可以开始第一集')
    }

    const navigateSafely = (label, action) => {
      if (storyDirty || draftDirty) return setPendingNavigation({ label, action })
      action()
    }

    const discardAndNavigate = () => {
      const action = pendingNavigation?.action
      setPendingNavigation(null)
      setDraft({ ...EMPTY_DRAFT })
      setSavedStory('')
      action?.()
    }

    const selectProject = id => {
      if (id === projectId) return
      navigateSafely('切换项目', () => {
        setProjectId(id)
        setOpenProjectIds(current => current.includes(id) ? current : [...current, id])
        setEpisodeIdToOpen('')
        setEpisode(null)
      })
    }

    const createEpisodeIn = id => {
      navigateSafely('新建单集', () => {
        setProjectId(id)
        setOpenProjectIds(current => current.includes(id) ? current : [...current, id])
        setEpisodeIdToOpen('')
        setEpisode(null)
        setSavedStory('')
        setDraft({ ...EMPTY_DRAFT })
        setActiveStage('story')
      })
    }

    const deleteProject = async () => {
      if (!projectToDelete) return
      const deletedId = projectToDelete.id
      const result = await call('/project.delete', { projectId: deletedId })
      if (!result) return
      const nextProject = projects.find(project => project.id !== deletedId)
      setProjects(current => current.filter(project => project.id !== deletedId))
      setSelectedProjectIds(current => current.filter(id => id !== deletedId))
      setOpenProjectIds(current => current.filter(id => id !== deletedId))
      setProjectEpisodes(current => {
        const next = { ...current }
        delete next[deletedId]
        return next
      })
      if (projectId === deletedId) {
        setProjectId(nextProject?.id || '')
        setEpisodeIdToOpen('')
        setEpisode(null)
      }
      setProjectToDelete(null)
      setMessage('项目已删除')
    }

    const toggleProject = id => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    }

    const toggleProjectOpen = id => {
      setOpenProjectIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    }

    const toggleAllProjects = () => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => current.length === projects.length ? [] : projects.map(project => project.id))
    }

    const runBulk = async action => {
      if (busyRef.current) return
      if (!selectedProjectIds.length) return
      if (action === 'start' && !batchAuthorized) return setError('批量启动前请确认所选项目内容合规且素材权利清晰')
      busyRef.current = true
      setBusy(true); setError(''); setMessage('')
      try {
        const projectEpisodes = await Promise.all(selectedProjectIds.map(async id => ({
          projectId: id,
          episodes: (await api.fetchJson('/episode.list', { projectId: id })).episodes || [],
        })))
        const requests = bulkProductionRequests(projectEpisodes, action)
        if (!requests.length) {
          setMessage(action === 'pause' ? '所选项目中没有正在生产的单集' : '所选项目中没有可启动或继续的单集')
          return
        }
        const results = await Promise.allSettled(requests.map(request => api.fetchJson(request.route, request.body)))
        const failures = results.filter(result => result.status === 'rejected')
        const succeeded = results.length - failures.length
        if (failures.length) setError(`已处理 ${succeeded} 个单集，${failures.length} 个失败：${failures[0].reason?.message || '未知错误'}`)
        else setMessage(`已${action === 'pause' ? '暂停' : '启动或继续'} ${succeeded} 个单集`)
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
      if (!projectId) return setError('请先创建项目')
      if (!draft.title.trim() || !draft.sourceText.trim()) return setError('请填写单集名称和故事')
      if (!draftValid) return setError('目标时长必须在 10–600 秒之间')
      const result = await call('/episode.create', { projectId, episodeId: makeEpisodeId(), ...draft, budget: draft.budget === '' ? null : Number(draft.budget) })
      if (!result) return
      setEpisode(result); setSavedStory(storyFingerprint(result.episode)); setDraft({ ...EMPTY_DRAFT }); setActiveStage('story')
      setEpisodeIdToOpen(result.episode.id)
      setProjectEpisodes(current => ({ ...current, [projectId]: episodesInCreationOrder([...(current[projectId] || []), { ...result.episode, status: result.state.status, activeStage: result.state.activeStage }]) }))
      setMessage('单集已保存，可继续编辑或开始自动规划')
    }

    const chooseEpisode = (ownerProjectId, id) => {
      if (ownerProjectId === projectId && id === selectedEpisodeId) return
      navigateSafely('切换单集', () => {
        setEpisode(null)
        setSavedStory('')
        setProjectId(ownerProjectId)
        setOpenProjectIds(current => current.includes(ownerProjectId) ? current : [...current, ownerProjectId])
        setEpisodeIdToOpen(id)
        setAuthorized(false)
        setReviewed(false)
      })
    }

    const saveStory = async () => {
      if (!storyValid) return setError('请填写名称和故事，并将目标时长设为 10–600 秒')
      const result = await call('/episode.update', { projectId, episodeId: selectedEpisodeId, updates: {
        sourceText: episode.episode.sourceText, title: episode.episode.title, targetDurationSec: episode.episode.targetDurationSec,
        aspectRatio: episode.episode.aspectRatio || '9:16', profile: episode.episode.profile, stylePrompt: episode.episode.stylePrompt, castPrompt: episode.episode.castPrompt,
      } })
      if (result) { setEpisode(result); setSavedStory(storyFingerprint(result.episode)); setMessage('故事设置已保存') }
    }

    const planEpisode = async () => {
      if (storyDirty) return setError('故事有未保存修改，请先保存再自动规划')
      if (!storyValid) return setError('请先完成有效的故事设置')
      const result = await call('/episode.plan', { projectId, episodeId: selectedEpisodeId })
      if (result) { setEpisode(result); setSavedStory(storyFingerprint(result.episode)); setActiveStage('script'); setMessage('Qwen3.8 已完成剧本与长视频规划') }
    }

    const start = async () => {
      if (storyDirty) return setError('请先保存故事修改')
      if (!hasPlan) return setError('请先完成自动规划')
      const authorizedBefore = Boolean(episode.state.authorizedAt)
      if (!authorizedBefore && !authorized) return setError('开始前请确认内容合规且素材权利清晰')
      const result = await call(authorizedBefore ? '/production.resume' : '/production.start', { projectId, episodeId: selectedEpisodeId, confirmAuthorizedContent: !authorizedBefore })
      if (result) { setMessage('自动生产已启动，你可以离开此页面，进度会持续保存'); await refresh(true) }
    }

    const pause = async () => {
      const result = await call('/production.pause', { projectId, episodeId: selectedEpisodeId })
      if (result) { setMessage('已暂停提交新任务，正在运行的任务会保存结果'); await refresh(true) }
    }

    const retry = async taskId => {
      const result = await call('/production.retry', { projectId, episodeId: selectedEpisodeId, taskId })
      if (result) { setMessage('该任务已重新排队'); await refresh(true) }
    }

    const approve = async () => {
      if (!reviewWatched || !reviewed) return setError('请完整观看当前成片后再确认')
      if (!reviewer.trim()) return setError('请输入审核人标识')
      const result = await call('/review.approve', { projectId, episodeId: selectedEpisodeId, reviewer: reviewer.trim(), confirmHumanReviewPassed: true })
      if (result) { setMessage('成片已通过人工终审'); await refresh(true) }
    }

    const updateDraft = patch => setDraft(value => ({ ...value, ...patch }))

    const renderTask = (task, index) => {
      const url = task.path ? api.mediaUrl(projectId, task.path) : ''
      const [, tone] = statusMeta(task.status)
      const placeholder = ['needs_attention', 'failed'].includes(task.status) ? '生成失败' : task.status === 'running' ? '生成中' : '等待生成'
      return h('article', { className: `ely-artifact is-${task.type} is-${tone}${url ? '' : ' is-empty'}`, key: task.id },
        h('div', { className: 'ely-artifact-preview' },
          url && !['chapter', 'final'].includes(task.type) ? h('img', { src: url, alt: task.entityId }) : null,
          url && ['chapter', 'final'].includes(task.type) ? h('video', { src: url, controls: true, preload: 'metadata' }) : null,
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
      h('header', { className: 'ely-create-head' }, h('div', null, h('span', { className: 'ely-eyebrow' }, selectedProject?.title || '项目'), h('h1', null, '创建新单集'), h('p', null, '写下故事，保存后再进行自动规划。')),
        (projectEpisodes[projectId] || []).length ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => chooseEpisode(projectId, projectEpisodes[projectId][0].id) }, '取消') : null),
      h('div', { className: 'ely-create-form' },
        h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', maxLength: 120, placeholder: '例如：雨夜来客', value: draft.title, onChange: event => updateDraft({ title: event.target.value }) })),
        h(Field, { label: '故事内容', hint: '至少写清开场、冲突和结尾；后续仍可修改。' }, h('textarea', { className: 'tf-textarea ely-story-input', maxLength: 20000, placeholder: '从一个能看见未来十秒的女孩开始……', value: draft.sourceText, onChange: event => updateDraft({ sourceText: event.target.value }) })),
        h('div', { className: 'ely-form-row' },
          h(Field, { label: '目标时长', hint: '10–600 秒' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', type: 'number', min: 10, max: 600, value: draft.targetDurationSec, onChange: event => updateDraft({ targetDurationSec: Number(event.target.value) }) }), h('span', null, '秒'))),
          h(Field, { label: '画幅' }, h('select', { className: 'tf-input', value: draft.aspectRatio, onChange: event => updateDraft({ aspectRatio: event.target.value }) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
        ),
        h(Field, { label: '生成质量', hint: draft.profile === 'final' ? '正式质量耗时与成本更高。' : '建议先用预览质量验证内容。' }, h('select', { className: 'tf-input', value: draft.profile, onChange: event => updateDraft({ profile: event.target.value }) }, h('option', { value: 'preview' }, '预览 · 快速验证'), h('option', { value: 'final' }, '正式 · 最终质量'))),
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
        body = h('div', { className: 'ely-editor' },
          storyLocked ? h('div', { className: 'ely-inline-notice' }, '生产进行中。请先暂停生产，再修改故事设置。') : null,
          h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', maxLength: 120, disabled: storyLocked, value: episode.episode.title, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, title: event.target.value } })) })),
          h(Field, { label: '故事内容', hint: storyDirty ? '有未保存修改；保存后才能重新规划。' : '修改后保存，再按需重新规划。' }, h('textarea', { className: 'tf-textarea ely-story-input', maxLength: 20000, disabled: storyLocked, value: episode.episode.sourceText, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, sourceText: event.target.value } })) })),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '目标时长', hint: '10–600 秒' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', disabled: storyLocked, type: 'number', min: 10, max: 600, value: episode.episode.targetDurationSec, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, targetDurationSec: Number(event.target.value) } })) }), h('span', null, '秒'))),
            h(Field, { label: '画幅' }, h('select', { className: 'tf-input', disabled: storyLocked, value: episode.episode.aspectRatio || '9:16', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, aspectRatio: event.target.value } })) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
          ),
          h(Field, { label: '生成质量' }, h('select', { className: 'tf-input', disabled: storyLocked, value: episode.episode.profile, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, profile: event.target.value } })) }, h('option', { value: 'preview' }, '预览 · 快速验证'), h('option', { value: 'final' }, '正式 · 最终质量'))),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '人物统一设定' }, h('input', { className: 'tf-input', disabled: storyLocked, value: episode.episode.castPrompt || '', placeholder: '人物外观、服装和气质', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, castPrompt: event.target.value } })) })),
            h(Field, { label: '画面风格' }, h('input', { className: 'tf-input', disabled: storyLocked, value: episode.episode.stylePrompt || '', placeholder: '色调、光线与镜头语言', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, stylePrompt: event.target.value } })) })),
          ),
        )
      } else if (activeStage === 'script') {
        body = h('div', { className: 'ely-document' }, h('blockquote', null, episode.script?.synopsis || episode.episode.sourceText),
          h('div', { className: 'ely-scene-list' }, (episode.script?.scenes || []).map((scene, index) => h('article', { key: scene.id }, h('span', null, String(index + 1).padStart(2, '0')), h('div', null, h('h3', null, scene.title), h('p', null, scene.summary))))))
      } else if (activeStage === 'assets') {
        body = h('div', { className: 'ely-assets' }, (episode.assets || []).length ? episode.assets.map(asset => {
          const task = episode.tasks.find(item => item.id === `asset:${asset.id}`)
          return h('article', { className: 'ely-asset-card', key: asset.id }, task ? renderTask(task, 0) : null,
            h('div', null, h('span', { className: 'ely-eyebrow' }, asset.type), h('h3', null, asset.name), h('p', null, asset.prompt)))
        }) : h('div', { className: 'ely-empty-state' }, h('strong', null, '没有独立资产'), h('p', null, '当前故事会直接使用全局视觉设定。')))
      } else if (activeStage === 'plan') {
        body = h('div', { className: 'ely-plan' },
          h('div', { className: 'ely-callout' }, episode.plan.source === 'producer-agent' ? '当前剧本和分镜由 Qwen3.8 生成，并已通过六锚点与重复内容校验。' : '当前为草稿规划；请先保存故事，再点击“自动规划”。'),
          h('div', { className: 'ely-chapter-list' }, episode.plan.chapters.map((chapter, chapterIndex) => h('article', { className: 'ely-chapter', key: chapter.id },
            h('header', null, h('span', null, `CHAPTER ${String(chapterIndex + 1).padStart(2, '0')}`), h('h3', null, chapter.title), h('small', null, `${chapter.anchors.length} 个画面锚点`)),
            h('div', { className: 'ely-anchor-list' }, chapter.anchors.map((anchor, index) => h('div', { className: 'ely-anchor-row', key: anchor.id },
              h('span', { className: 'ely-anchor-index' }, String(index + 1).padStart(2, '0')),
              h('div', null, h('small', null, index === 0 ? '文生图 · 起始帧' : '图生图 · 连续关键帧'), h('p', null, anchor.imagePrompt)),
            ))),
          ))))
      } else if (activeStage === 'final' && episode.state.final) {
        const finalUrl = api.mediaUrl(projectId, episode.state.final.path)
        body = h('div', { className: 'ely-final' },
          h('div', { className: 'ely-final-player' }, h('video', { src: finalUrl, controls: true, preload: 'metadata', onEnded: () => setReviewWatched(true) })),
          h('div', { className: 'ely-final-meta' }, h('div', null, h('span', null, '技术质检'), h('strong', null, `${episode.state.final.qc?.durationSec || '—'} 秒`), h('small', null, `目标 ${episode.episode.targetDurationSec} 秒`)), h(StatusPill, { status: episode.state.status })),
          episode.state.status === 'awaiting_review' ? h('div', { className: 'ely-review' }, h('h3', null, '人工终审'), h('p', null, '请完整播放成片，确认画面连续性、人物一致性和内容完整性。'),
            h(Field, { label: '审核人' }, h('input', { className: 'tf-input', maxLength: 120, placeholder: '输入审核人标识', value: reviewer, onChange: event => setReviewer(event.target.value) })),
            h('label', { className: `ely-check${reviewWatched ? '' : ' is-disabled'}` }, h('input', { type: 'checkbox', disabled: !reviewWatched, checked: reviewed, onChange: event => setReviewed(event.target.checked) }), h('span', null, reviewWatched ? '我已完整观看并确认成片通过' : '完整播放至结尾后可确认')),
          ) : null,
          h('div', { className: 'ely-final-actions' }, h('a', { className: 'ely-btn ely-btn-secondary ely-download', href: finalUrl, download: `${episode.episode.title || 'elysium'}.mp4` }, '下载成片')),
        )
      } else {
        const tasks = tasksForStage(episode.tasks, activeStage)
        body = tasks.length ? h('div', { className: 'ely-artifact-grid' }, tasks.map(renderTask)) : h('div', { className: 'ely-empty-state' }, h('strong', null, '尚未生成产物'), h('p', null, '启动自动生产后，结果会实时出现在这里。'))
      }
      return h('section', { className: 'ely-stage-panel' },
        h('header', { className: 'ely-stage-header' }, h('div', null, h('span', { className: 'ely-eyebrow' }, `STAGE ${stage.short}`), h('h2', null, stage.label), h('p', null, stage.hint)),
          h('div', { className: 'ely-stage-state' }, activeStage === 'story' && storyDirty ? h('span', { className: 'ely-stage-unsaved' }, '未保存') : null, h('span', { className: `ely-stage-mark is-${stageState(episode, stage.key, STAGES.findIndex(item => item.key === stage.key))}`, role: 'img', 'aria-label': `${stage.label}阶段状态` }))),
        body)
    }

    const primaryAction = () => {
      if (episode.state.status === 'running') return h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: pause }, '暂停生产')
      if (episode.state.status === 'needs_attention') return h('span', { className: 'ely-primary-guidance' }, openIssues.length > 1 ? '请在下方逐项重试失败任务' : '请使用下方“重试”恢复流程')
      if (episode.state.status === 'awaiting_review') return activeStage === 'final'
        ? h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !reviewer.trim() || !reviewWatched || !reviewed, title: !reviewWatched ? '请先完整播放成片' : !reviewer.trim() ? '请输入审核人标识' : !reviewed ? '请确认终审结果' : '提交终审', onClick: approve }, busy ? '提交中…' : '通过终审')
        : h('button', { className: 'ely-btn ely-btn-primary', onClick: () => setActiveStage('final') }, '前往终审')
      if (episode.state.status === 'approved') return activeStage === 'final'
        ? h('button', { className: 'ely-btn ely-btn-secondary', disabled: true }, '本集已完成')
        : h('button', { className: 'ely-btn ely-btn-secondary', onClick: () => setActiveStage('final') }, '查看成片')
      if (storyDirty) return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || storyLocked || !storyValid, title: !storyValid ? '请填写有效的名称、故事和目标时长' : '保存当前故事修改', onClick: saveStory }, busy ? '保存中…' : '保存修改')
      if (!hasPlan) return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || storyLocked || !storyValid, title: !storyValid ? '请填写有效的名称、故事和目标时长' : '生成剧本与长视频规划', onClick: planEpisode }, busy ? '规划中…' : '自动规划')
      return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || storyDirty || (!episode.state.authorizedAt && !authorized), title: storyDirty ? '请先保存故事修改' : '', onClick: start }, busy ? '处理中…' : episode.state.status === 'paused' ? '继续生产' : '开始自动生产')
    }

    const nextStep = () => {
      if (episode.state.status === 'running') return ['自动生产进行中', activeTasks ? `${activeTasks} 项任务正在排队或生成，你可以离开当前页面。` : '系统正在推进下一项任务，进度会自动更新。']
      if (episode.state.status === 'needs_attention') return ['先处理异常', `${openIssues.length || 1} 项问题阻止流程继续，修复后会从断点恢复。`]
      if (episode.state.status === 'awaiting_review') return ['观看并验收成片', '完整播放成片，确认连续性与内容质量后完成终审。']
      if (episode.state.status === 'approved') return ['本集已完成', '成片已经通过终审，可在“成片”阶段查看交付结果。']
      if (storyDirty) return ['先保存故事修改', '当前修改尚未保存，保存后才能开始或继续生产。']
      if (!hasPlan) return ['先完成自动规划', '进入“故事”阶段补全内容，再生成剧本、资产和长视频规划。']
      if (!episode.state.authorizedAt) return ['确认后开始生产', '勾选内容与素材授权，系统将自动完成后续阶段。']
      return ['继续自动生产', '系统会从当前进度继续，并保留已经完成的有效产物。']
    }

    return h('div', { className: 'ely-studio' },
      h('aside', { className: 'ely-library' },
        h('div', { className: 'ely-library-head' }, h('span', null, '我的项目'), h('button', { title: showProjectForm ? '收起新建项目' : '新建项目', 'aria-label': showProjectForm ? '收起新建项目' : '新建项目', 'aria-expanded': showProjectForm, disabled: busy, onClick: () => setShowProjectForm(value => !value) }, showProjectForm ? '×' : '+')),
        showProjectForm ? h('div', { className: 'ely-project-create' }, h('input', { className: 'tf-input', autoFocus: true, maxLength: 120, placeholder: '项目名称', value: projectTitle, onChange: event => setProjectTitle(event.target.value), onKeyDown: event => { if (event.key === 'Enter' && projectTitle.trim()) navigateSafely('创建并切换项目', createProject) } }), h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !projectTitle.trim(), title: projectTitle.trim() ? '创建项目' : '请输入项目名称', onClick: () => navigateSafely('创建并切换项目', createProject) }, busy ? '创建中…' : '创建')) : null,
        projectsLoading ? h('div', { className: 'ely-library-empty', role: 'status' }, '正在加载项目…') : projects.length ? h(React.Fragment, null,
          h('div', { className: 'ely-project-toolbar' },
            h('button', { disabled: busy, onClick: toggleAllProjects }, selectedProjectIds.length === projects.length ? '清空' : '全选'),
            h('span', null, selectedProjectIds.length ? `已选 ${selectedProjectIds.length}` : '勾选后批量操作')),
          h('div', { className: 'ely-project-list' }, projects.map(project => {
            const items = projectEpisodes[project.id] || []
            const expanded = openProjectIds.includes(project.id)
            return h('section', { key: project.id, className: `ely-project-group ${project.id === projectId ? 'is-active' : ''}` },
              h('div', { className: 'ely-project-main' },
                h('input', { type: 'checkbox', 'aria-label': `选择项目 ${project.title}`, checked: selectedProjectIds.includes(project.id), disabled: busy, onChange: () => toggleProject(project.id) }),
                h('button', { className: 'ely-project-toggle', title: expanded ? '收起单集' : '展开单集', 'aria-label': `${expanded ? '收起' : '展开'}项目 ${project.title}`, 'aria-expanded': expanded, disabled: busy, onClick: () => toggleProjectOpen(project.id) }, '›'),
                h('button', { className: 'ely-project-title', title: project.title, disabled: busy, onClick: () => selectProject(project.id) }, h('strong', null, project.title), h('small', null, `${items.length} 集`)),
                h('div', { className: 'ely-project-actions' },
                  h('button', { className: 'ely-add-episode', title: `在 ${project.title} 中新建单集`, 'aria-label': `在 ${project.title} 中新建单集`, disabled: busy, onClick: () => createEpisodeIn(project.id) }, '+'),
                  h('button', { className: 'ely-delete-project', title: `删除项目 ${project.title}`, 'aria-label': `删除项目 ${project.title}`, disabled: busy, onClick: () => setProjectToDelete(project) }, '−'))),
              expanded ? h('div', { className: 'ely-project-episodes', role: 'list', 'aria-label': `${project.title}的单集` }, items.length
                ? items.map((item, index) => { const [label, tone] = statusMeta(item.status); return h('button', { key: item.id, role: 'listitem', className: item.id === selectedEpisodeId && project.id === projectId ? 'is-active' : '', disabled: busy, onClick: () => chooseEpisode(project.id, item.id) }, h('span', { className: 'ely-episode-order' }, String(index + 1).padStart(2, '0')), h('span', null, h('strong', null, item.title), h('small', null, label)), h('i', { className: `is-${tone}` })) })
                : h('span', { className: 'ely-project-no-episodes' }, '暂无单集')) : null)
          })),
          selectedProjectIds.length ? h('div', { className: 'ely-project-batch' },
            h('label', null, h('input', { type: 'checkbox', checked: batchAuthorized, disabled: !batchStartCount, onChange: event => setBatchAuthorized(event.target.checked) }), h('span', null, batchStartCount ? `确认 ${batchStartCount} 个单集内容及素材已获授权` : '没有可启动的单集')),
            h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || storyDirty || draftDirty || !batchAuthorized || !batchStartCount, title: storyDirty || draftDirty ? '请先处理当前未保存内容' : batchStartCount ? '启动就绪单集，并继续已暂停单集' : '没有就绪或已暂停的单集', onClick: () => void runBulk('start') }, `启动 / 继续 (${batchStartCount})`),
            h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy || storyDirty || draftDirty || !batchPauseCount, title: storyDirty || draftDirty ? '请先处理当前未保存内容' : batchPauseCount ? '暂停所选项目中正在生产的单集' : '没有正在生产的单集', onClick: () => void runBulk('pause') }, `暂停 (${batchPauseCount})`)) : null)
          : null,
        !projectsLoading && !projects.length ? h('div', { className: 'ely-library-empty' }, '创建项目后开始制作') : null),
      h('main', { className: 'ely-workspace' },
        (error || message) && !episode ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}`, role: error ? 'alert' : 'status' }, h('span', null, error || message), h('button', { 'aria-label': '关闭提示', onClick: () => { setError(''); setMessage('') } }, '×')) : null,
        projectsLoading || episodeLoading ? h('section', { className: 'ely-zero', role: 'status' }, h('span', { className: 'ely-loading-ring' }), h('h1', null, '正在打开工作台'), h('p', null, '正在恢复项目、单集和生产状态…'))
          : !projectId ? h('section', { className: 'ely-zero' }, h('span', { className: 'ely-zero-logo' }, 'E'), h('h1', null, '创建你的第一个世界'), h('p', null, '项目用于集中管理同一系列中的故事、人物资产和成片。'), h('button', { className: 'ely-btn ely-btn-primary', onClick: () => setShowProjectForm(true) }, '新建项目'))
            : !episode ? renderCreateEpisode()
            : h('div', { className: 'ely-production' },
              h('header', { className: 'ely-production-head' },
                h('div', { className: 'ely-production-title' }, h('span', { className: 'ely-breadcrumb', title: selectedProject?.title || '项目' }, selectedProject?.title || '项目', ' / 单集'), h('h1', { title: episode.episode.title }, episode.episode.title), h('div', { className: 'ely-production-meta' }, h(StatusPill, { status: episode.state.status }), h('span', { className: 'ely-current-stage' }, `当前：${currentStage.label}`), h('span', null, `${episode.episode.targetDurationSec} 秒`), h('span', null, episode.episode.profile === 'final' ? '正式质量' : '预览质量'))),
                h('button', { className: 'ely-head-refresh', disabled: busy || storyDirty, onClick: () => refresh(false), title: storyDirty ? '请先保存或放弃故事修改' : '刷新生产状态' }, busy ? '更新中…' : '刷新状态')),
              (error || message) ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}`, role: error ? 'alert' : 'status' }, h('span', null, error || message), h('button', { 'aria-label': '关闭提示', onClick: () => { setError(''); setMessage('') } }, '×')) : null,
              h('div', { className: 'ely-production-layout' },
                h('nav', { className: 'ely-stage-track', 'aria-label': '制作流程' },
                  h('div', { className: 'ely-stage-track-title' }, h('strong', null, '制作流程'), h('span', null, `已完成 ${completedStageCount}/8`)),
                  STAGES.map((stage, index) => { const state = stageState(episode, stage.key, index); return h('button', { key: stage.key, className: `${stage.key === activeStage ? 'is-active ' : ''}is-${state}`, 'aria-current': stage.key === activeStage ? 'step' : undefined, disabled: busy, onClick: () => setActiveStage(stage.key) }, h('span', null, state === 'complete' ? '✓' : stage.short), h('span', { className: 'ely-stage-copy' }, h('strong', null, stage.label), h('small', null, stage.hint))) })),
                h('div', { className: 'ely-stage-content' }, renderStageContent()),
                h('aside', { className: 'ely-production-rail' },
                  h('section', { className: 'ely-next-card', 'aria-live': 'polite' }, h('span', { className: 'ely-rail-kicker' }, '下一步'), h('h2', null, nextStep()[0]), h('p', null, nextStep()[1]),
                    hasPlan && !episode.state.authorizedAt && !['approved', 'awaiting_review'].includes(episode.state.status) ? h('label', { className: 'ely-authorization' }, h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }), h('span', null, h('strong', null, '生产授权'), h('small', null, '确认内容合规且拥有素材使用权'))) : null,
                    h('div', { className: 'ely-primary-action' }, primaryAction())),
                  openIssues.length ? h('section', { className: 'ely-attention' }, h('header', null, h('div', null, h('span', null, '!'), h('strong', null, `${openIssues.length} 项需要处理`))), openIssues.map(issue => h('article', { key: issue.id }, h('div', null, h('strong', null, issue.code), h('p', null, issue.message)), h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => retry(issue.taskId) }, '重试')))) : null,
                  totalTasks ? h('section', { className: 'ely-progress-card' }, h('div', { className: 'ely-progress-copy' }, h('strong', null, '总体进度'), h('span', null, `${completeTasks} / ${totalTasks} 项任务完成`)), h('strong', { className: 'ely-progress-value' }, `${progress}%`), h('div', { className: 'ely-progress-track' }, h('i', { style: { width: `${progress}%` } }))) : null,
                  totalTasks ? h('section', { className: 'ely-queue-card' }, h('div', null, h('span', null, '进行中'), h('strong', null, activeTasks)), h('div', null, h('span', null, '待处理'), h('strong', { className: openIssues.length ? 'is-danger' : '' }, openIssues.length))) : null)),
              )),
        projectToDelete ? h(ConfirmDialog, {
          title: '删除项目',
          message: `确定删除“${projectToDelete.title}”吗？项目下的全部单集与产物也会被删除，且无法恢复。`,
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
    )
  }
}
