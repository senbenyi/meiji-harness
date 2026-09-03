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
  if (stage === 'script' && detail.script?.scenes?.length) return 'complete'
  if (stage === 'plan' && detail.plan?.chapters?.length) return 'complete'
  const currentIndex = STAGES.findIndex(item => item.key === detail.state?.activeStage)
  if (currentIndex === index && ['running', 'queued'].includes(detail.state?.status)) return 'active'
  return 'pending'
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
  const { createElement: h, useCallback, useEffect, useState } = React

  function StatusPill({ status }) {
    const [label, tone] = statusMeta(status)
    return h('span', { className: `ely-status is-${tone}` }, h('i'), label)
  }

  function Field({ label, hint, children }) {
    return h('label', { className: 'ely-field' }, h('span', { className: 'ely-field-label' }, label), children, hint ? h('small', null, hint) : null)
  }

  return function Studio({ initialProjectId, initialEpisodeId, onSelection }) {
    const [projects, setProjects] = useState([])
    const [projectId, setProjectId] = useState(initialProjectId || '')
    const [selectedProjectIds, setSelectedProjectIds] = useState([])
    const [batchAuthorized, setBatchAuthorized] = useState(false)
    const [episodes, setEpisodes] = useState([])
    const [episode, setEpisode] = useState(null)
    const [activeStage, setActiveStage] = useState('story')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [authorized, setAuthorized] = useState(false)
    const [reviewed, setReviewed] = useState(false)
    const [reviewer, setReviewer] = useState('')
    const [showProjectForm, setShowProjectForm] = useState(false)
    const [projectTitle, setProjectTitle] = useState('')
    const [draft, setDraft] = useState({ title: '', sourceText: '', targetDurationSec: 60, aspectRatio: '9:16', profile: 'preview', budget: '', stylePrompt: '', castPrompt: '' })

    const selectedEpisodeId = episode?.episode?.id || ''
    const selectedProject = projects.find(project => project.id === projectId)
    const openIssues = (episode?.issues || []).filter(issue => issue.status === 'open')
    const completeTasks = (episode?.tasks || []).filter(task => task.status === 'succeeded').length
    const totalTasks = episode?.tasks?.length || 0
    const progress = totalTasks ? Math.round((completeTasks / totalTasks) * 100) : 0

    const call = useCallback(async (route, body = {}, quiet = false) => {
      if (!quiet) { setBusy(true); setError(''); setMessage('') }
      try { return await api.fetchJson(route, body) }
      catch (reason) { setError(reason.message || String(reason)); return null }
      finally { if (!quiet) setBusy(false) }
    }, [])

    const loadProjects = useCallback(async () => {
      const result = await call('/project.list', {}, true)
      if (!result) return
      setProjects(result.projects || [])
      setSelectedProjectIds(current => current.filter(id => result.projects?.some(project => project.id === id)))
      if (!projectId && result.projects?.length) setProjectId(result.projects[0].id)
    }, [call, projectId])

    const loadEpisodes = useCallback(async (id = projectId) => {
      if (!id) { setEpisodes([]); setEpisode(null); return }
      const result = await call('/episode.list', { projectId: id }, true)
      if (!result) return
      setEpisodes(result.episodes || [])
      const wanted = episode?.episode?.projectId === id ? episode.episode.id : initialEpisodeId
      const next = result.episodes?.find(item => item.id === wanted) || result.episodes?.[0]
      if (!next) return setEpisode(null)
      const detail = await call('/episode.get', { projectId: id, episodeId: next.id }, true)
      if (detail) { setEpisode(detail); setActiveStage(visibleStage(detail.state?.activeStage)) }
    }, [call, projectId, initialEpisodeId, episode?.episode?.id, episode?.episode?.projectId])

    const refresh = useCallback(async (quiet = true) => {
      if (!projectId || !selectedEpisodeId) return
      const result = await call('/production.status', { projectId, episodeId: selectedEpisodeId }, quiet)
      if (result) {
        setEpisode(result)
        setEpisodes(current => current.map(item => item.id === selectedEpisodeId
          ? { ...item, title: result.episode.title, status: result.state.status, activeStage: result.state.activeStage }
          : item))
      }
    }, [call, projectId, selectedEpisodeId])

    useEffect(() => { void loadProjects() }, [])
    useEffect(() => { void loadEpisodes(projectId) }, [projectId])
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
      setProjectTitle(''); setShowProjectForm(false); await loadProjects(); setProjectId(result.project.id); setEpisode(null)
      setMessage('项目已创建，现在可以开始第一集')
    }

    const selectProject = id => {
      setProjectId(id)
      setEpisode(null)
    }

    const toggleProject = id => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    }

    const toggleAllProjects = () => {
      setBatchAuthorized(false)
      setSelectedProjectIds(current => current.length === projects.length ? [] : projects.map(project => project.id))
    }

    const runBulk = async action => {
      if (!selectedProjectIds.length) return
      if (action === 'start' && !batchAuthorized) return setError('批量启动前请确认所选项目内容合规且素材权利清晰')
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
        if (action === 'start') setBatchAuthorized(false)
        if (selectedProjectIds.includes(projectId)) await loadEpisodes(projectId)
      } catch (reason) {
        setError(reason.message || String(reason))
      } finally {
        setBusy(false)
      }
    }

    const createEpisode = async () => {
      if (!projectId) return setError('请先创建项目')
      if (!draft.title.trim() || !draft.sourceText.trim()) return setError('请填写单集名称和故事')
      const result = await call('/episode.create', { projectId, episodeId: makeEpisodeId(), ...draft, budget: draft.budget === '' ? null : Number(draft.budget) })
      if (!result) return
      setEpisode(result); setActiveStage('story')
      setEpisodes(current => [{ ...result.episode, status: result.state.status, activeStage: result.state.activeStage }, ...current])
      setMessage('单集已建立，Qwen3.8 已完成剧本与长视频规划')
    }

    const chooseEpisode = async id => {
      const result = await call('/episode.get', { projectId, episodeId: id })
      if (!result) return
      setEpisode(result); setActiveStage(visibleStage(result.state?.activeStage)); setAuthorized(false); setReviewed(false)
    }

    const saveStory = async () => {
      const result = await call('/episode.update', { projectId, episodeId: selectedEpisodeId, updates: {
        sourceText: episode.episode.sourceText, title: episode.episode.title, targetDurationSec: episode.episode.targetDurationSec,
        aspectRatio: episode.episode.aspectRatio || '9:16', profile: episode.episode.profile, stylePrompt: episode.episode.stylePrompt, castPrompt: episode.episode.castPrompt,
      } })
      if (result) { setEpisode(result); setMessage('已保存；内容变化时 Qwen3.8 会同步重做规划') }
    }

    const start = async () => {
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
      if (!reviewed) return setError('请完整观看当前成片后再确认')
      const result = await call('/review.approve', { projectId, episodeId: selectedEpisodeId, reviewer, confirmHumanReviewPassed: true })
      if (result) { setMessage('成片已通过人工终审'); await refresh(true) }
    }

    const renderTask = (task, index) => {
      const url = task.path ? api.mediaUrl(projectId, task.path) : ''
      return h('article', { className: `ely-artifact is-${task.type}`, key: task.id },
        h('div', { className: 'ely-artifact-preview' },
          url && !['chapter', 'final'].includes(task.type) ? h('img', { src: url, alt: task.entityId }) : null,
          url && ['chapter', 'final'].includes(task.type) ? h('video', { src: url, controls: true, preload: 'metadata' }) : null,
          !url ? h('div', { className: 'ely-artifact-placeholder' }, h('span', null, task.status === 'running' ? '生成中' : '等待生成')) : null,
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
      h('div', { className: 'ely-create-form' },
        h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', placeholder: '例如：雨夜来客', value: draft.title, onChange: event => setDraft(value => ({ ...value, title: event.target.value })) })),
        h(Field, { label: '故事内容' }, h('textarea', { className: 'tf-textarea ely-story-input', placeholder: '从一个能看见未来十秒的女孩开始……', value: draft.sourceText, onChange: event => setDraft(value => ({ ...value, sourceText: event.target.value })) })),
        h('div', { className: 'ely-form-row' },
          h(Field, { label: '目标时长' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', type: 'number', min: 20, max: 600, value: draft.targetDurationSec, onChange: event => setDraft(value => ({ ...value, targetDurationSec: Number(event.target.value) })) }), h('span', null, '秒'))),
          h(Field, { label: '画幅' }, h('select', { className: 'tf-input', value: draft.aspectRatio, onChange: event => setDraft(value => ({ ...value, aspectRatio: event.target.value })) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
        ),
        h(Field, { label: '生成质量' }, h('select', { className: 'tf-input', value: draft.profile, onChange: event => setDraft(value => ({ ...value, profile: event.target.value })) }, h('option', { value: 'preview' }, '预览 · 快速验证'), h('option', { value: 'final' }, '正式 · 最终质量'))),
        h('details', { className: 'ely-advanced' }, h('summary', null, '视觉设定（选填）'),
          h(Field, { label: '人物统一设定' }, h('input', { className: 'tf-input', placeholder: '主角的外观、服装和气质', value: draft.castPrompt, onChange: event => setDraft(value => ({ ...value, castPrompt: event.target.value })) })),
          h(Field, { label: '画面风格' }, h('input', { className: 'tf-input', placeholder: '电影感、色调、光线与镜头语言', value: draft.stylePrompt, onChange: event => setDraft(value => ({ ...value, stylePrompt: event.target.value })) }))),
        h('button', { className: 'ely-btn ely-btn-primary ely-btn-wide', disabled: busy, onClick: createEpisode }, busy ? 'Qwen3.8 正在规划…' : '建立单集并自动规划'),
      ),
    )

    const renderStageContent = () => {
      const stage = STAGES.find(item => item.key === activeStage) || STAGES[0]
      let body
      if (activeStage === 'story') {
        body = h('div', { className: 'ely-editor' },
          h(Field, { label: '单集名称' }, h('input', { className: 'tf-input', value: episode.episode.title, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, title: event.target.value } })) })),
          h(Field, { label: '故事内容', hint: '修改故事或时长后，受影响的下游产物会自动失效并重新规划' }, h('textarea', { className: 'tf-textarea ely-story-input', value: episode.episode.sourceText, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, sourceText: event.target.value } })) })),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '目标时长' }, h('div', { className: 'ely-input-suffix' }, h('input', { className: 'tf-input', type: 'number', min: 20, max: 600, value: episode.episode.targetDurationSec, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, targetDurationSec: Number(event.target.value) } })) }), h('span', null, '秒'))),
            h(Field, { label: '画幅' }, h('select', { className: 'tf-input', value: episode.episode.aspectRatio || '9:16', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, aspectRatio: event.target.value } })) }, h('option', { value: '9:16' }, '9:16 · 竖屏'), h('option', { value: '16:9' }, '16:9 · 横屏'))),
          ),
          h(Field, { label: '生成质量' }, h('select', { className: 'tf-input', value: episode.episode.profile, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, profile: event.target.value } })) }, h('option', { value: 'preview' }, '预览 · 快速验证'), h('option', { value: 'final' }, '正式 · 最终质量'))),
          h('div', { className: 'ely-form-row' },
            h(Field, { label: '人物统一设定' }, h('input', { className: 'tf-input', value: episode.episode.castPrompt || '', placeholder: '人物外观、服装和气质', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, castPrompt: event.target.value } })) })),
            h(Field, { label: '画面风格' }, h('input', { className: 'tf-input', value: episode.episode.stylePrompt || '', placeholder: '色调、光线与镜头语言', onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, stylePrompt: event.target.value } })) })),
          ),
          h('div', { className: 'ely-editor-actions' }, h('button', { className: 'ely-btn ely-btn-primary', disabled: busy, onClick: saveStory }, '保存')),
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
          h('div', { className: 'ely-callout' }, episode.plan.source === 'producer-agent' ? '当前剧本和分镜由 Qwen3.8 生成，并已通过六锚点与重复内容校验。' : '这是旧版或人工规划；修改故事并保存后会由 Qwen3.8 重新规划。'),
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
          h('div', { className: 'ely-final-player' }, h('video', { src: finalUrl, controls: true, preload: 'metadata' })),
          h('div', { className: 'ely-final-meta' }, h('div', null, h('span', null, '技术质检'), h('strong', null, `${episode.state.final.qc?.durationSec || '—'} 秒`), h('small', null, `目标 ${episode.episode.targetDurationSec} 秒`)), h(StatusPill, { status: episode.state.status })),
          episode.state.status === 'awaiting_review' ? h('div', { className: 'ely-review' }, h('h3', null, '人工终审'), h('p', null, '请完整播放成片，确认画面连续性、人物一致性和内容完整性。'),
            h(Field, { label: '审核人' }, h('input', { className: 'tf-input', placeholder: '输入审核人标识', value: reviewer, onChange: event => setReviewer(event.target.value) })),
            h('label', { className: 'ely-check' }, h('input', { type: 'checkbox', checked: reviewed, onChange: event => setReviewed(event.target.checked) }), h('span', null, '我已完整观看并确认成片通过')),
            h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !reviewer || !reviewed, onClick: approve }, '通过终审')) : null,
        )
      } else {
        const tasks = tasksForStage(episode.tasks, activeStage)
        body = tasks.length ? h('div', { className: 'ely-artifact-grid' }, tasks.map(renderTask)) : h('div', { className: 'ely-empty-state' }, h('strong', null, '尚未生成产物'), h('p', null, '启动自动生产后，结果会实时出现在这里。'))
      }
      return h('section', { className: 'ely-stage-panel' },
        h('header', { className: 'ely-stage-header' }, h('div', null, h('span', { className: 'ely-eyebrow' }, `STAGE ${stage.short}`), h('h2', null, stage.label), h('p', null, stage.hint)), h('span', { className: `ely-stage-mark is-${stageState(episode, stage.key, STAGES.findIndex(item => item.key === stage.key))}` })),
        body)
    }

    const primaryAction = () => {
      if (episode.state.status === 'running') return h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: pause }, '暂停生产')
      if (episode.state.status === 'needs_attention') return h('button', { className: 'ely-btn ely-btn-secondary', disabled: true }, '请先处理异常')
      if (episode.state.status === 'awaiting_review') return h('button', { className: 'ely-btn ely-btn-primary', onClick: () => setActiveStage('final') }, '前往终审')
      if (episode.state.status === 'approved') return h('button', { className: 'ely-btn ely-btn-secondary', onClick: () => setActiveStage('final') }, '查看成片')
      return h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || (!episode.state.authorizedAt && !authorized), onClick: start }, episode.state.status === 'paused' ? '继续生产' : '开始自动生产')
    }

    return h('div', { className: 'ely-studio' },
      h('aside', { className: 'ely-library' },
        h('div', { className: 'ely-library-head' }, h('span', null, '我的项目'), h('button', { title: '新建项目', onClick: () => setShowProjectForm(value => !value) }, '+')),
        showProjectForm ? h('div', { className: 'ely-project-create' }, h('input', { className: 'tf-input', autoFocus: true, placeholder: '项目名称', value: projectTitle, onChange: event => setProjectTitle(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void createProject() } }), h('button', { className: 'ely-btn ely-btn-primary', disabled: busy, onClick: createProject }, '创建')) : null,
        projects.length ? h(React.Fragment, null,
          h('div', { className: 'ely-project-toolbar' },
            h('button', { onClick: toggleAllProjects }, selectedProjectIds.length === projects.length ? '清空' : '全选'),
            h('span', null, selectedProjectIds.length ? `已选 ${selectedProjectIds.length}` : '勾选后批量操作')),
          h('div', { className: 'ely-project-list' }, projects.map(project => h('div', { key: project.id, className: project.id === projectId ? 'is-active' : '' },
            h('input', { type: 'checkbox', 'aria-label': `选择项目 ${project.title}`, checked: selectedProjectIds.includes(project.id), onChange: () => toggleProject(project.id) }),
            h('button', { title: project.title, onClick: () => selectProject(project.id) }, h('strong', null, project.title), h('small', null, project.id === projectId ? '正在查看' : '打开项目'))))),
          selectedProjectIds.length ? h('div', { className: 'ely-project-batch' },
            h('label', null, h('input', { type: 'checkbox', checked: batchAuthorized, onChange: event => setBatchAuthorized(event.target.checked) }), h('span', null, '确认所选内容及素材已获授权')),
            h('button', { className: 'ely-btn ely-btn-primary', disabled: busy || !batchAuthorized, title: '启动就绪单集，并继续已暂停单集', onClick: () => void runBulk('start') }, '批量启动 / 继续'),
            h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, title: '暂停所选项目中正在生产的单集', onClick: () => void runBulk('pause') }, '批量暂停')) : null)
          : h('div', { className: 'ely-library-empty' }, '创建项目后开始制作'),
        projectId ? h(React.Fragment, null,
          h('div', { className: 'ely-library-label' },
            h('span', null, '单集'),
            h('div', null, h('small', null, episodes.length), h('button', { className: 'ely-add-episode', title: '新建单集', onClick: () => { setEpisode(null); setActiveStage('story') } }, '+ 新建'))),
          h('div', { className: 'ely-episode-list' }, episodes.map(item => { const [label, tone] = statusMeta(item.status); return h('button', { key: item.id, className: item.id === selectedEpisodeId ? 'is-active' : '', onClick: () => void chooseEpisode(item.id) }, h('span', null, h('strong', null, item.title), h('small', null, label)), h('i', { className: `is-${tone}` })) }))) : h('div', { className: 'ely-library-empty' }, '创建项目后开始制作')),
      h('main', { className: 'ely-workspace' },
        (error || message) && !episode ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}` }, h('span', null, error || message), h('button', { onClick: () => { setError(''); setMessage('') } }, '×')) : null,
        !projectId ? h('section', { className: 'ely-zero' }, h('span', { className: 'ely-zero-logo' }, 'E'), h('h1', null, '创建你的第一个世界'), h('p', null, '项目用于集中管理同一系列中的故事、人物资产和成片。'), h('button', { className: 'ely-btn ely-btn-primary', onClick: () => setShowProjectForm(true) }, '新建项目'))
          : !episode ? renderCreateEpisode()
            : h(React.Fragment, null,
              h('header', { className: 'ely-production-head' },
                h('div', { className: 'ely-production-title' }, h('span', { className: 'ely-breadcrumb' }, selectedProject?.title || '项目', ' / 单集'), h('h1', null, episode.episode.title), h('div', { className: 'ely-production-meta' }, h(StatusPill, { status: episode.state.status }), h('span', null, `${episode.episode.targetDurationSec} 秒`), h('span', null, episode.episode.profile === 'final' ? '正式质量' : '预览质量'))),
                h('div', { className: 'ely-production-action' }, primaryAction())),
              !episode.state.authorizedAt && !['approved', 'awaiting_review'].includes(episode.state.status) ? h('label', { className: 'ely-authorization' }, h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }), h('span', null, h('strong', null, '生产授权'), h('small', null, '确认内容合规且拥有素材使用权')), h('i', null)) : null,
              h('section', { className: 'ely-progress-card' }, h('div', { className: 'ely-progress-copy' }, h('strong', null, episode.state.status === 'running' ? '正在自动生产' : episode.state.status === 'awaiting_review' ? '成片等待你的确认' : episode.state.status === 'approved' ? '本集制作完成' : '制作进度'), h('span', null, `${completeTasks} / ${totalTasks} 项任务`)), h('strong', { className: 'ely-progress-value' }, `${progress}%`), h('div', { className: 'ely-progress-track' }, h('i', { style: { width: `${progress}%` } }))),
              (error || message) ? h('div', { className: `ely-toast ${error ? 'is-error' : 'is-success'}` }, h('span', null, error || message), h('button', { onClick: () => { setError(''); setMessage('') } }, '×')) : null,
              openIssues.length ? h('section', { className: 'ely-attention' }, h('header', null, h('div', null, h('span', null, '!'), h('strong', null, `${openIssues.length} 项需要处理`)), h('small', null, '其他可执行任务不会受影响')), openIssues.map(issue => h('article', { key: issue.id }, h('div', null, h('strong', null, issue.code), h('p', null, issue.message)), h('button', { className: 'ely-btn ely-btn-secondary', disabled: busy, onClick: () => retry(issue.taskId) }, '重试')))) : null,
              h('nav', { className: 'ely-stage-track', 'aria-label': '制作流程' }, STAGES.map((stage, index) => { const state = stageState(episode, stage.key, index); return h('button', { key: stage.key, className: `${stage.key === activeStage ? 'is-active ' : ''}is-${state}`, onClick: () => setActiveStage(stage.key) }, h('span', null, state === 'complete' ? '✓' : stage.short), h('strong', null, stage.label)) })),
              renderStageContent())),
    )
  }
}
