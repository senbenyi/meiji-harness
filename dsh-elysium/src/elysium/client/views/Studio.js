const STAGES = [
  ['story', '故事'],
  ['script', '剧本'],
  ['assets', '资产'],
  ['plan', '长视频规划'],
  ['start_frame', '文生图起始帧'],
  ['keyframes', '故事关键帧'],
  ['chapters', '长视频章节'],
  ['final', '成片'],
]

function episodeId() {
  return `episode-${Date.now().toString(36)}`
}

function taskLabel(task) {
  const labels = { start_frame: '起始帧', keyframe: '关键帧', chapter: '章节视频', final: '成片' }
  return `${labels[task.type] || task.type} · ${task.entityId}`
}

export function createStudio(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useState } = React

  return function Studio({ initialProjectId, initialEpisodeId, onSelection }) {
    const [projects, setProjects] = useState([])
    const [projectId, setProjectId] = useState(initialProjectId || '')
    const [episodes, setEpisodes] = useState([])
    const [episode, setEpisode] = useState(null)
    const [activeStage, setActiveStage] = useState('story')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [authorized, setAuthorized] = useState(false)
    const [reviewed, setReviewed] = useState(false)
    const [reviewer, setReviewer] = useState('')
    const [projectTitle, setProjectTitle] = useState('')
    const [draft, setDraft] = useState({ title: '', sourceText: '', targetDurationSec: 60, profile: 'preview', budget: '', stylePrompt: '', castPrompt: '' })

    const selectedEpisodeId = episode?.episode?.id || initialEpisodeId || ''
    const call = useCallback(async (route, body = {}, quiet = false) => {
      if (!quiet) {
        setBusy(true)
        setError('')
        setMessage('')
      }
      try {
        return await api.fetchJson(route, body)
      } catch (reason) {
        setError(reason.message || String(reason))
        return null
      } finally {
        if (!quiet) setBusy(false)
      }
    }, [])

    const loadProjects = useCallback(async () => {
      const result = await call('/project.list', {}, true)
      if (!result) return
      setProjects(result.projects || [])
      if (!projectId && result.projects?.length) setProjectId(result.projects[0].id)
    }, [call, projectId])

    const loadEpisodes = useCallback(async (id = projectId) => {
      if (!id) {
        setEpisodes([])
        setEpisode(null)
        return
      }
      const result = await call('/episode.list', { projectId: id }, true)
      if (!result) return
      setEpisodes(result.episodes || [])
      const wanted = episode?.episode?.projectId === id ? episode.episode.id : initialEpisodeId
      const next = result.episodes?.find(item => item.id === wanted) || result.episodes?.[0]
      if (next) {
        const detail = await call('/episode.get', { projectId: id, episodeId: next.id }, true)
        if (detail) setEpisode(detail)
      } else {
        setEpisode(null)
      }
    }, [call, projectId, initialEpisodeId, episode?.episode?.id, episode?.episode?.projectId])

    const refresh = useCallback(async (quiet = true) => {
      if (!projectId || !selectedEpisodeId) return
      const result = await call('/production.status', { projectId, episodeId: selectedEpisodeId }, quiet)
      if (result) setEpisode(result)
    }, [call, projectId, selectedEpisodeId])

    useEffect(() => { void loadProjects() }, [])
    useEffect(() => { void loadEpisodes(projectId) }, [projectId])
    useEffect(() => {
      onSelection?.(projectId || null, selectedEpisodeId || null)
    }, [projectId, selectedEpisodeId, onSelection])
    useEffect(() => {
      if (!['running', 'queued'].includes(episode?.state?.status)) return undefined
      const timer = window.setInterval(() => void refresh(true), 2500)
      return () => window.clearInterval(timer)
    }, [episode?.state?.status, refresh])

    const createProject = async () => {
      if (!projectTitle.trim()) return setError('请输入项目名称')
      const result = await call('/project.create', { title: projectTitle.trim() })
      if (!result) return
      setProjectTitle('')
      await loadProjects()
      setProjectId(result.project.id)
      setMessage('项目已创建')
    }

    const createEpisode = async () => {
      if (!projectId) return setError('请先创建项目')
      if (!draft.title.trim() || !draft.sourceText.trim()) return setError('请填写单集名称和故事')
      const result = await call('/episode.create', {
        projectId,
        episodeId: episodeId(),
        ...draft,
        budget: draft.budget === '' ? null : Number(draft.budget),
      })
      if (!result) return
      setEpisode(result)
      await loadEpisodes(projectId)
      setMessage('单集已创建，长视频规划草案已生成')
    }

    const chooseEpisode = async id => {
      const result = await call('/episode.get', { projectId, episodeId: id })
      if (result) {
        setEpisode(result)
        setActiveStage('story')
      }
    }

    const saveStory = async () => {
      const result = await call('/episode.update', {
        projectId,
        episodeId: selectedEpisodeId,
        updates: {
          sourceText: episode.episode.sourceText,
          title: episode.episode.title,
          targetDurationSec: episode.episode.targetDurationSec,
          profile: episode.episode.profile,
          stylePrompt: episode.episode.stylePrompt,
          castPrompt: episode.episode.castPrompt,
        },
      })
      if (result) {
        setEpisode(result)
        setMessage('上游输入已保存，受影响任务已重新规划')
      }
    }

    const start = async () => {
      if (!authorized) return setError('请先确认内容合规且素材权利清晰')
      const result = await call('/production.start', { projectId, episodeId: selectedEpisodeId, confirmAuthorizedContent: true })
      if (result) {
        setMessage('自动生产已启动')
        await refresh(true)
      }
    }

    const pause = async () => {
      const result = await call('/production.pause', { projectId, episodeId: selectedEpisodeId })
      if (result) {
        setMessage('已暂停提交新任务；运行中的远端任务仍会保存结果')
        await refresh(true)
      }
    }

    const retry = async taskId => {
      const result = await call('/production.retry', { projectId, episodeId: selectedEpisodeId, taskId })
      if (result) {
        setMessage('问题已重置，可以继续自动生产')
        await refresh(true)
      }
    }

    const approve = async () => {
      if (!reviewed) return setError('请完整观看当前成片后再确认')
      const result = await call('/review.approve', { projectId, episodeId: selectedEpisodeId, reviewer, confirmHumanReviewPassed: true })
      if (result) {
        setMessage('当前成片已通过人工终审')
        await refresh(true)
      }
    }

    const stageTasks = useMemo(() => {
      if (!episode?.tasks) return []
      if (activeStage === 'start_frame') return episode.tasks.filter(task => task.type === 'start_frame')
      if (activeStage === 'keyframes') return episode.tasks.filter(task => task.type === 'keyframe')
      if (activeStage === 'chapters') return episode.tasks.filter(task => task.type === 'chapter')
      if (activeStage === 'final') return episode.tasks.filter(task => task.type === 'final')
      return []
    }, [episode?.tasks, activeStage])

    const renderTask = task => {
      const url = task.path ? api.mediaUrl(projectId, task.path) : ''
      return h('article', { className: 'ely-task', key: task.id },
        h('div', { className: 'ely-task-head' },
          h('strong', null, taskLabel(task)),
          h('span', { className: `ely-status is-${task.status}` }, task.status),
        ),
        url && task.type !== 'chapter' && task.type !== 'final' ? h('img', { src: url, alt: task.entityId }) : null,
        url && (task.type === 'chapter' || task.type === 'final') ? h('video', { src: url, controls: true, preload: 'metadata' }) : null,
        task.error ? h('div', { className: 'ely-task-error' }, task.error) : null,
        task.status === 'needs_attention' ? h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: () => retry(task.id) }, '重试此项') : null,
      )
    }

    let content
    if (!episode) {
      content = h('section', { className: 'ely-empty-workspace' },
        h('h2', null, projectId ? '创建第一集' : '创建项目'),
        projectId ? h(React.Fragment, null,
          h('input', { className: 'tf-input', placeholder: '单集名称', value: draft.title, onChange: event => setDraft(value => ({ ...value, title: event.target.value })) }),
          h('textarea', { className: 'tf-textarea ely-story-input', placeholder: '输入故事想法或原文', value: draft.sourceText, onChange: event => setDraft(value => ({ ...value, sourceText: event.target.value })) }),
          h('div', { className: 'ely-form-row' },
            h('input', { className: 'tf-input', type: 'number', min: 20, max: 600, value: draft.targetDurationSec, onChange: event => setDraft(value => ({ ...value, targetDurationSec: Number(event.target.value) })) }),
            h('select', { className: 'tf-input', value: draft.profile, onChange: event => setDraft(value => ({ ...value, profile: event.target.value })) },
              h('option', { value: 'preview' }, '预览质量'), h('option', { value: 'final' }, '正式质量')),
          ),
          h('input', { className: 'tf-input', placeholder: '人物统一设定（可选）', value: draft.castPrompt, onChange: event => setDraft(value => ({ ...value, castPrompt: event.target.value })) }),
          h('input', { className: 'tf-input', placeholder: '画面风格（可选）', value: draft.stylePrompt, onChange: event => setDraft(value => ({ ...value, stylePrompt: event.target.value })) }),
          h('button', { className: 'tf-btn', disabled: busy, onClick: createEpisode }, '创建单集'),
        ) : h('p', null, '先在顶部创建一个项目。'),
      )
    } else if (activeStage === 'story') {
      content = h('section', { className: 'ely-editor' },
        h('label', null, '单集名称'),
        h('input', { className: 'tf-input', value: episode.episode.title, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, title: event.target.value } })) }),
        h('label', null, '故事'),
        h('textarea', { className: 'tf-textarea ely-story-input', value: episode.episode.sourceText, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, sourceText: event.target.value } })) }),
        h('div', { className: 'ely-form-row' },
          h('input', { className: 'tf-input', type: 'number', min: 20, max: 600, value: episode.episode.targetDurationSec, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, targetDurationSec: Number(event.target.value) } })) }),
          h('select', { className: 'tf-input', value: episode.episode.profile, onChange: event => setEpisode(value => ({ ...value, episode: { ...value.episode, profile: event.target.value } })) },
            h('option', { value: 'preview' }, '预览质量'), h('option', { value: 'final' }, '正式质量')),
        ),
        h('button', { className: 'tf-btn', disabled: busy, onClick: saveStory }, '保存'),
      )
    } else if (activeStage === 'assets') {
      content = h('section', { className: 'ely-editor' },
        h('label', null, '人物统一设定'), h('div', { className: 'ely-readonly' }, episode.episode.castPrompt || '由故事与规划共同约束'),
        h('label', null, '画面风格'), h('div', { className: 'ely-readonly' }, episode.episode.stylePrompt || '统一竖屏电影风格'),
      )
    } else if (activeStage === 'script' || activeStage === 'plan') {
      content = h('section', { className: 'ely-plan' },
        h('div', { className: 'ely-note' }, episode.plan.source === 'auto-draft' ? '当前为自动规划草案，可由 DeepSeek 通过生产工具更新为精细规划。' : '当前规划已由 AI 或人工编辑。'),
        episode.plan.chapters.map(chapter => h('article', { className: 'ely-chapter', key: chapter.id },
          h('h3', null, chapter.title),
          chapter.anchors.map(anchor => h('div', { className: 'ely-anchor-row', key: anchor.id },
            h('span', { className: 'ely-anchor-index' }, anchor.order),
            h('span', null, anchor.imagePrompt),
          )),
        )),
      )
    } else if (activeStage === 'final' && episode.state.final) {
      const finalUrl = api.mediaUrl(projectId, episode.state.final.path)
      content = h('section', { className: 'ely-final' },
        h('video', { src: finalUrl, controls: true, preload: 'metadata' }),
        h('div', { className: 'ely-note' }, `技术 QC：${episode.state.final.qc?.durationSec || '-'} 秒 / 目标 ${episode.episode.targetDurationSec} 秒`),
        episode.state.status === 'awaiting_review' ? h(React.Fragment, null,
          h('input', { className: 'tf-input', placeholder: '审核人标识', value: reviewer, onChange: event => setReviewer(event.target.value) }),
          h('label', { className: 'ely-check' }, h('input', { type: 'checkbox', checked: reviewed, onChange: event => setReviewed(event.target.checked) }), '我已完整观看并确认成片通过'),
          h('button', { className: 'tf-btn', disabled: busy || !reviewer || !reviewed, onClick: approve }, '通过人工终审'),
        ) : null,
      )
    } else {
      content = h('section', { className: 'ely-task-grid' }, stageTasks.length ? stageTasks.map(renderTask) : h('div', { className: 'ely-note' }, '此阶段尚无产物'))
    }

    return h('div', { className: 'ely-studio' },
      h('header', { className: 'ely-topbar' },
        h('strong', null, '极乐世界'),
        h('select', { className: 'tf-input', value: projectId, onChange: event => { setProjectId(event.target.value); setEpisode(null) } },
          h('option', { value: '' }, '选择项目'), projects.map(project => h('option', { key: project.id, value: project.id }, project.title))),
        h('input', { className: 'tf-input', placeholder: '新项目名称', value: projectTitle, onChange: event => setProjectTitle(event.target.value) }),
        h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: createProject }, '新建项目'),
        projectId ? h('select', { className: 'tf-input', value: selectedEpisodeId, onChange: event => void chooseEpisode(event.target.value) },
          h('option', { value: '' }, '新建单集'), episodes.map(item => h('option', { key: item.id, value: item.id }, item.title))) : null,
      ),
      error ? h('div', { className: 'tf-error' }, error) : null,
      message ? h('div', { className: 'tf-success' }, message) : null,
      episode ? h('div', { className: 'ely-controlbar' },
        h('span', { className: `ely-status is-${episode.state.status}` }, episode.state.status),
        h('span', null, `${episode.tasks.filter(task => task.status === 'succeeded').length}/${episode.tasks.length} 项完成`),
        h('label', { className: 'ely-check' }, h('input', { type: 'checkbox', checked: authorized, onChange: event => setAuthorized(event.target.checked) }), '确认内容合规与素材权利'),
        episode.state.status === 'running'
          ? h('button', { className: 'tf-btn tf-btn-ghost', disabled: busy, onClick: pause }, '暂停')
          : h('button', { className: 'tf-btn', disabled: busy || episode.state.status === 'approved', onClick: start }, episode.state.status === 'paused' ? '继续生产' : '开始自动生产'),
      ) : null,
      h('div', { className: 'ely-layout' },
        episode ? h('nav', { className: 'ely-stages' }, STAGES.map(([key, label]) => h('button', { key, className: key === activeStage ? 'is-active' : '', onClick: () => setActiveStage(key) }, label))) : null,
        h('main', { className: 'ely-main' }, content),
        episode ? h('aside', { className: 'ely-issues' },
          h('h3', null, '需要处理'),
          episode.issues.filter(issue => issue.status === 'open').length
            ? episode.issues.filter(issue => issue.status === 'open').map(issue => h('article', { key: issue.id }, h('strong', null, issue.code), h('p', null, issue.message), h('button', { className: 'tf-btn tf-btn-ghost', onClick: () => retry(issue.taskId) }, '重试')))
            : h('div', { className: 'ely-note' }, '暂无异常'),
        ) : null,
      ),
    )
  }
}
