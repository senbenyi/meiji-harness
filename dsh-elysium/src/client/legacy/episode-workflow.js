// 职责：以手机式导航编排分集剧情、镜头编辑、人工审核与单集播放。
window.__ModuleLoader__.load({ id: 'elysium/episode-workflow', factory: require => {
  const { createElement: h, useEffect, useState, useRef } = require('react')
  const { workflowAction } = require('elysium/project-api')
  const { ProjectConfiguration } = require('elysium/project-configuration')
  const { DeliveryView } = require('elysium/delivery')
  const { EpisodeOverview, EpisodeShotList, EpisodeShotEditor, shotsFor, filmsFor, episodeStatus } = require('elysium/episode-ui')
  function ProjectWorkflow({ project, busy, run, guard, back = () => {}, error, notice, viewState = {}, onViewState = () => {} }) {
    const { generate } = require('elysium/project-generation')
    const [stack, setStack] = useState(viewState.stack || [{ type: 'overview' }])
    const positions = useRef(viewState.positions || { pages: {}, rails: {} }), bodyRef = useRef(null)
    const page = stack[stack.length - 1], pageKey = [page.type, page.episodeId, page.shotId, page.filmKey].filter(Boolean).join(':')
    const episode = project.episodes.find(item => item.id === page.episodeId)
    const w = episode?.workflow || project.workflow, shots = episode ? shotsFor(project, episode.id) : []
    const savedShot = shots.find(item => item.id === page.shotId)
    const [draft, setDraft] = useState(project), [plot, setPlot] = useState(''), [title, setTitle] = useState(''), [shot, setShot] = useState(null), [dirty, setDirty] = useState(false)
    useEffect(() => {
      if (dirty) return
      setDraft(project); setPlot(episode?.workflow.plot || ''); setTitle(episode?.title || ''); setShot(savedShot ? { ...savedShot } : null)
    }, [project.updated_at, pageKey, dirty])
    useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = positions.current.pages[pageKey] || 0 }, [pageKey])
    useEffect(() => {
      if (!guard || !dirty) return
      const leave = next => { if (window.confirm('放弃未保存的修改？')) { setDirty(false); next() } }
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const remember = next => { setStack(next); onViewState({ stack: next, positions: positions.current }) }
    const navigate = next => { if (dirty && !window.confirm('放弃未保存的修改？')) return; setDirty(false); remember([...stack, next]) }
    const goBack = () => {
      if (dirty && !window.confirm('放弃未保存的修改？')) return
      setDirty(false)
      if (stack.length > 1) remember(stack.slice(0, -1)); else back()
    }
    const execute = async (operation, next) => {
      const ok = await run(operation)
      if (ok) { setDirty(false); if (next) remember(typeof next === 'function' ? next(stack) : [...stack, next]) }
      return ok
    }
    const scopedAction = (name, data = {}) => workflowAction(project.id, name, { revision: w.revision, ...(episode ? { episode_id: episode.id } : {}), ...data })
    const running = state => Boolean(state.request) || ['video', 'submitting'].includes(state.stage)
    const globalRequest = project.workflow.request?.episode_ids ? project.workflow.request : null
    const locked = busy || Boolean(globalRequest) || running(w)
    const configLocked = busy || Boolean(globalRequest) || project.episodes.some(item => running(item.workflow))
    const configure = () => workflowAction(project.id, 'configure', { revision: project.workflow.revision, configuration: draft.configuration, brief: draft.brief, mode: draft.mode, episode_count: draft.episode_count })
    const savePlot = () => scopedAction('edit', { plot, title })
    const saveShot = () => scopedAction('edit', { shots: shots.map(item => item.id === page.shotId ? shot : item) })
    const currentFilm = episode && filmsFor(project, episode.id).find(item => (item.job_id || item.url) === page.filmKey)
    const number = episode ? project.episodes.indexOf(episode) + 1 : 0
    const headings = { overview: project.title, configuration: '项目配置', plot: `第 ${number} 集 · 剧情`, storyboard: `第 ${number} 集 · 分镜`, shot: `第 ${number} 集 · 镜头 ${String(shots.findIndex(item => item.id === page.shotId) + 1).padStart(2, '0')}`, video: `第 ${number} 集 · 成片` }
    const parentType = stack.length > 1 ? stack[stack.length - 2].type : null
    const parentLabel = ({ overview: '项目总览', storyboard: '分镜列表', plot: '剧情', video: '成片', configuration: '项目配置' })[parentType] || '项目列表'
    const request = globalRequest || w.request
    const change = setter => event => { setter(event.target.value); setDirty(true) }
    const stale = episode && w.storyboard_revision !== w.revision && shots.length > 0
    const count = project.episodes.length
    const plotsReady = project.episodes.filter(e => e.workflow.plot && !e.workflow.plot_stale).length
    const shotsReady = project.episodes.filter(e => e.workflow.storyboard_revision === e.workflow.revision && shotsFor(project, e.id).length).length
    const filmsReady = project.episodes.filter(e => e.workflow.stage === 'complete' && e.workflow.storyboard_revision === e.workflow.revision && filmsFor(project, e.id).some(f => f.job_id === e.workflow.job_id)).length
    const steps = {
      configuration: { label: '下一步：生成全部剧情', disabled: configLocked, run: () => execute(async () => generate(await workflowAction(project.id, 'configure', { revision: project.workflow.revision, mode: project.mode, configuration: project.configuration, brief: project.brief, episode_count: count }), 'plot')) },
      plot: { label: '下一步：审核通过，生成全部分镜', progress: `剧情已完成 ${plotsReady}/${count} 集`, disabled: configLocked || plotsReady !== count, run: () => execute(() => generate(project, 'storyboard')) },
      storyboard: { label: '下一步：审核通过，生成全部成片', progress: `分镜已完成 ${shotsReady}/${count} 集`, disabled: configLocked || shotsReady !== count, run: () => execute(() => scopedAction('submit-series')) },
      video: { label: project.reviewed_at ? '项目已完成' : '下一步：确认全部成片，完成项目', progress: `成片已完成 ${filmsReady}/${count} 集`, disabled: configLocked || filmsReady !== count || Boolean(project.reviewed_at), run: () => execute(() => scopedAction('finish')) },
    }
    let content, actions
    if (page.type === 'overview') content = h(EpisodeOverview, { project, navigate, positions: positions.current.rails, steps })
    else if (page.type === 'configuration') {
      content = h(ProjectConfiguration, { project: draft, busy: configLocked, onChange: value => { setDraft(value); setDirty(true) } })
      actions = [h('button', { key: 'save', disabled: configLocked, onClick: () => execute(configure) }, '保存配置'),
        h('button', { key: 'next', className: 'elysium-primary', disabled: configLocked, onClick: () => execute(async () => generate(await configure(), 'plot'), () => [{ type: 'overview' }]) }, '下一步：生成分集剧情')]
    } else if (!episode) content = h('p', { role: 'alert' }, '该剧集已不存在，请返回项目总览。')
    else if (page.type === 'plot') {
      content = h('div', { className: 'elysium-episode-plot' }, w.plot_stale ? h('p', { role: 'alert' }, '项目素材已改变，请检查并保存本集剧情，或重新生成。') : null,
        h('section', { className: 'elysium-edit-section' }, h('h2', null, '本集故事'),
          h('label', { className: 'elysium-field' }, '剧集标题', h('input', { 'aria-label': '剧集标题', value: title, disabled: locked, maxLength: 500, onChange: change(setTitle) })),
          h('label', { className: 'elysium-field' }, '剧情正文', h('textarea', { 'aria-label': '剧情正文', rows: 10, value: plot, disabled: locked, placeholder: '本集的故事从这里开始，也可以点击下方由 AI 生成。', onChange: change(setPlot) })),
          h('p', { className: 'elysium-plot-count' }, `${[...plot.replace(/\s/g, '')].length}/200 字`)))
      actions = [h('button', { key: 'generate', disabled: locked || dirty, onClick: () => execute(() => generate(project, 'plot', episode.id)) }, 'AI 生成本集'),
        h('button', { key: 'save', disabled: locked || !plot.trim() || !title.trim(), onClick: () => execute(savePlot) }, '保存'),
        h('button', { key: 'next', className: 'elysium-primary', disabled: configLocked || !plot.trim() || !title.trim() || project.episodes.some(e => e.id !== episode.id && (!e.workflow.plot || e.workflow.plot_stale)), onClick: () => execute(async () => generate(await savePlot(), 'storyboard'), () => [{ type: 'overview' }]) }, '下一步：审核通过，生成全部分镜')]
    } else if (page.type === 'storyboard') {
      content = h('div', null, stale ? h('p', { role: 'alert' }, '剧情或素材已改变，本集分镜需重新生成。') : null, h(EpisodeShotList, { project, episode, navigate }))
      actions = [h('button', { key: 'plot', onClick: () => navigate({ type: 'plot', episodeId: episode.id }) }, '查看剧情'),
        h('button', { key: 'generate', disabled: locked || !w.plot || w.plot_stale, onClick: () => execute(() => generate(project, 'storyboard', episode.id)) }, shots.length ? '重新生成分镜' : '生成本集分镜'),
        h('button', { key: 'submit', className: 'elysium-primary', disabled: configLocked || shotsReady !== count, onClick: () => execute(() => workflowAction(project.id, 'submit-series', { revision: project.workflow.revision }), () => [{ type: 'overview' }]) }, '下一步：审核通过，生成全部成片')]
    } else if (page.type === 'shot') {
      content = shot ? h(EpisodeShotEditor, { project, shot, index: shots.findIndex(item => item.id === page.shotId), locked: locked || stale, onChange: value => { setShot(value); setDirty(true) } }) : h('p', null, '镜头已不存在，请返回列表。')
      actions = [h('button', { key: 'cancel', onClick: goBack }, '返回列表'), h('button', { key: 'save', className: 'elysium-primary', disabled: locked || stale || !shot || !dirty, onClick: () => execute(saveShot, current => current.slice(0, -1)) }, '保存镜头')]
    } else {
      const films = filmsFor(project, episode.id)
      const selected = currentFilm || (!page.filmKey ? films.find(item => item.job_id === w.job_id) : null)
      content = h('div', { className: 'elysium-episode-player' }, h('div', { className: 'elysium-list-intro' }, h('h2', null, episode.title), h('p', { role: 'status' }, episodeStatus(episode, 'video', project))),
        selected ? h(DeliveryView, { key: selected.job_id || selected.url, project: { ...project, acts: project.acts.filter(act => act.episode_id === episode.id), deliverables: [selected] }, autoPlay: true })
          : h('div', { className: 'elysium-series-empty' }, h('strong', null, page.filmKey ? '此成片已不可用' : w.stage === 'failed' ? '本集视频生成失败' : w.job_id ? '正在制作本集成片' : '这一集还没有成片'), h('p', null, '本集视频会在审核分镜并生成完成后展示。')))
      actions = [w.stage === 'failed' ? h('button', { key: 'retry', disabled: busy, onClick: () => execute(() => scopedAction('retry')) }, '重试本集任务') : null, h('button', { key: 'shots', onClick: () => navigate({ type: 'storyboard', episodeId: episode.id }) }, '查看本集分镜')]
    }
    return h('div', { className: 'elysium-project-workflow elysium-step-detail elysium-series-workflow' },
      h('header', { className: 'elysium-app-navbar' }, page.type !== 'overview' ? h('button', { 'aria-label': `返回${parentLabel}`, onClick: goBack }, h('span', { 'aria-hidden': true }, '‹'), parentLabel) : h('span', null, '当前项目'), h('h1', null, headings[page.type]), h('span', { className: 'elysium-nav-state', role: 'status' }, busy ? '保存中' : dirty ? '未保存' : '')),
      h('div', { className: 'elysium-step-detail-body', key: pageKey, ref: bodyRef, onScroll: event => { positions.current.pages[pageKey] = event.currentTarget.scrollTop } },
        error || w.error ? h('p', { role: 'alert' }, error || w.error) : null, notice ? h('p', { role: 'status' }, notice) : null,
        request ? h('div', { className: 'elysium-generating-notice', role: 'status' }, `AI 正在生成${request.episode_ids ? '全部分集' : '本集'}${request.stage === 'plot' ? '剧情' : '分镜'}…`, h('button', { disabled: busy, onClick: () => execute(() => workflowAction(project.id, 'cancel', { revision: globalRequest ? project.workflow.revision : w.revision, ...(!globalRequest && episode ? { episode_id: episode.id } : {}) })) }, '取消生成')) : null,
        content),
      actions ? h('footer', { className: 'elysium-step-detail-footer' }, actions) : null)
  }
  return { ProjectWorkflow }
} })
