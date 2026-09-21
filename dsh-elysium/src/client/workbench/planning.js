// 职责：让运营查看、重新生成、手改与定稿剧情规划的各个版本。
window.__ModuleLoader__.load({ id: 'elysium/planning', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { readPlanning, generatePlanning, editPlanning, finalizePlanning, fetchEpisode, saveEpisode, composeFilm } = require('elysium/project-api')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const labels = { logline: '一句话梗概', genre: '题材', episode_count: '集数', episode_seconds: '单集秒数', world: '世界观',
    characters: '角色', scenes: '场景', id: '标识', name: '名称', appearance: '外观', voice: '音色', personality: '性格',
    episodes: '分集剧情', number: '集号', title: '标题', summary: '梗概', hook: '结尾钩子',
    beats: '时间线', start: '开始秒数', end: '结束秒数', plot: '情节', emotion: '情绪', tone: '语气',
    scene_id: '场景', roles: '人物', action: '动作', dialogue: '对白', role: '说话角色', text: '台词',
    shots: '镜头', shot_size: '景别', camera: '运镜', duration: '秒数', prompt: '视频提示词' }
  const defaults = { characters: { id: '', name: '', appearance: '', voice: '', personality: '' },
    scenes: { id: '', name: '', description: '' }, episodes: { number: 1, title: '', summary: '', hook: '' },
    beats: { start: 0, end: 10, scene_id: '', roles: [], plot: '', emotion: '', dialogue: [] },
    dialogue: { role: '', text: '', tone: '' }, shots: { scene_id: '', roles: [], shot_size: '', camera: '', action: '', duration: 5, dialogue: [] } }
  const copy = value => JSON.parse(JSON.stringify(value))

  function Field({ name, value, onChange, path = '' }) {
    const label = labels[name] || name, field = path ? `${path} · ${label}` : label
    if (Array.isArray(value)) return h('fieldset', { className: 'elysium-planning-array' },
      h('legend', null, label),
      value.map((item, index) => h('div', { key: index, className: 'elysium-planning-item' },
        h(Field, { name: `${label} ${index + 1}`, value: item, path: field, onChange: next => onChange(value.map((old, i) => i === index ? next : old)) }),
        h('button', { type: 'button', className: 'elysium-danger', onClick: () => onChange(value.filter((_, i) => i !== index)) }, `删除${label} ${index + 1}`))),
      h('button', { type: 'button', onClick: () => onChange([...value, copy(name === 'dialogue' && path.includes('镜头')
        ? { role: '', text: '' } : defaults[name] ?? (typeof value[0] === 'string' ? '' : value[0] || ''))]) }, `添加${label}`))
    if (value && typeof value === 'object') return h('div', { className: 'elysium-planning-fields' },
      Object.entries(value).map(([key, item]) => h(Field, { key, name: key, value: item, path: field,
        onChange: next => onChange({ ...value, [key]: next }) })))
    const numeric = typeof value === 'number'
    const multiline = ['prompt', 'world', 'action', 'appearance', 'description', 'plot', 'summary'].includes(name)
    return h('label', { className: 'elysium-field' }, h('span', null, label),
      multiline ? h('textarea', { 'aria-label': field, rows: name === 'prompt' ? 14 : 3, value: value ?? '', onChange: event => onChange(event.target.value) })
        : h('input', { 'aria-label': field, type: numeric ? 'number' : 'text', value: value ?? '',
          onChange: event => onChange(numeric ? Number(event.target.value) : event.target.value) }))
  }

  function PlanningView({ projectId, step, episode, shotId, title, onFinalized, onChanged, refresh = 0 }) {
    const [planning, setPlanning] = useState(null), [version, setVersion] = useState(0)
    const [draft, setDraft] = useState(null), [requirements, setRequirements] = useState('')
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, refresh])
    const entry = step === 'series' ? planning?.[step]
      : step === 'shot-prompt' ? planning?.episodes?.[episode]?.prompts?.[shotId] : planning?.episodes?.[episode]?.[step]
    const selected = entry?.versions.find(item => item.version === (version || entry.versions.at(-1)?.version))
    const unsaved = Boolean(draft && selected && JSON.stringify(draft) !== JSON.stringify(selected.value))
    useEffect(() => { setDraft(selected ? copy(selected.value) : null) }, [selected?.version, step, episode, shotId])
    async function run(operation) {
      setBusy(true); setError('')
      try {
        const value = await operation()
        setPlanning(value)
        onChanged?.(value)
        return value
      } catch (err) { setError(err.message); return null }
      finally { setBusy(false) }
    }
    return h('section', { className: 'elysium-planning' },
      h('h2', null, title),
      entry?.needs_review ? h('p', { role: 'status' }, '上游定稿已变化，本步骤需复核') : null,
      error ? h('p', { role: 'alert' }, error) : null,
      h('label', null, '版本', h('select', { 'aria-label': `${title}版本`, value: selected?.version || '', onChange: event => setVersion(Number(event.target.value)) },
        !selected ? h('option', { value: '' }, '尚无版本') : null,
        entry?.versions.map(item => h('option', { key: item.version, value: item.version }, `第 ${item.version} 版${entry.finalized === item.version ? ' · 已定稿' : ''}`)))),
      draft ? h('div', { className: 'elysium-planning-content', 'aria-label': `${title}内容` },
        Object.entries(draft).map(([key, value]) => h(Field, { key, name: key, value, onChange: next => setDraft({ ...draft, [key]: next }) }))) : h('p', null, '尚无规划内容，点击生成开始'),
      h('label', null, '补充要求', h('textarea', { 'aria-label': `${title}补充要求`, rows: 3, value: requirements, disabled: busy, onChange: event => setRequirements(event.target.value) })),
      h('div', { className: 'elysium-planning-actions' },
        h('button', { type: 'button', className: selected ? '' : 'elysium-primary', disabled: busy, onClick: async () => { const value = await run(() => generatePlanning(projectId, step, episode, shotId, requirements)); if (value) { setVersion(0); setRequirements('') } } }, selected ? '按补充要求重新生成' : '生成'),
        h('button', { type: 'button', className: unsaved ? 'elysium-primary' : '', disabled: busy || !draft, onClick: async () => {
          const saved = await run(() => editPlanning(projectId, step, episode, shotId, draft))
          if (saved) setVersion(0)
        } }, '保存'),
        h('button', { type: 'button', className: selected && !unsaved ? 'elysium-primary' : '', disabled: busy || !selected, onClick: async () => {
          const value = await run(() => finalizePlanning(projectId, step, episode, shotId, selected.version))
          if (value) onFinalized?.(value)
        } }, '定稿')))
  }

  const finalValue = entry => entry?.versions.find(item => item.version === entry.finalized)?.value
  const episodeCount = planning => finalValue(planning?.series)?.episode_count || 1
  function reviewReason(planning, project, episode, shot) {
    if (!planning?.series?.finalized) return ''
    const entry = planning.episodes?.[episode]
    if (!entry?.timeline?.finalized || entry.timeline.needs_review) return '本集时间线需复核'
    if (!entry.storyboard?.finalized || entry.storyboard.needs_review) return '本集分镜需复核'
    if (!shot) return ''
    if (entry.prompts?.[shot.id]?.needs_review) return `镜头 ${shot.id} 提示词需复核`
    for (const role of [...(shot.roles || []), `scene-${shot.scene}`]) {
      const anchor = project?.anchors.find(item => item.role === role)
      if (!anchor || anchor.retired) return `镜头 ${shot.id} 引用的锚点 ${role} 已失效`
    }
    return ''
  }

  function ScriptView({ projectId, onChanged = () => {} }) {
    const [planning, setPlanning] = useState(null), [episode, setEpisode] = useState(1)
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(''), [refresh, setRefresh] = useState(0)
    useEffect(() => { readPlanning(projectId).then(setPlanning).catch(err => setError(err.message)) }, [projectId])
    const series = finalValue(planning?.series), count = series?.episode_count || 0
    const changed = value => { setPlanning(value); onChanged(value) }
    async function generateAll() {
      setBusy(true); setError('')
      let value = planning
      let number = 1
      try {
        for (; number <= count; number++) {
          setProgress(`${number}/${count}`)
          if (value.episodes?.[number]?.timeline?.finalized) continue
          value = await generatePlanning(projectId, 'timeline', number)
          changed(value); setRefresh(current => current + 1)
        }
      } catch (err) { setError(`第 ${number} 集：${err.message}`) }
      finally { setBusy(false) }
    }
    return h('div', { className: 'elysium-script-view' },
      h(PlanningView, { projectId, step: 'series', title: '剧情总览', onChanged: changed }),
      series ? h('section', { className: 'elysium-timeline-list' }, h('div', { className: 'elysium-section-heading' }, h('h2', null, '分集时间线'),
        h('button', { type: 'button', className: 'elysium-primary', disabled: busy, onClick: generateAll }, busy ? `生成中 ${progress}` : '生成全部集时间线')),
        progress ? h('p', { role: 'status' }, `时间线进度 ${progress}`) : null,
        error ? h('p', { role: 'alert' }, error) : null,
        h('div', { className: 'elysium-timeline-episodes' }, series.episodes.map(item => {
          const entry = planning?.episodes?.[item.number]?.timeline
          const status = entry?.needs_review ? '需复核' : entry?.finalized ? '已定稿' : entry?.versions.length ? '草稿' : '未生成'
          return h('button', { type: 'button', key: item.number, 'aria-current': episode === item.number, onClick: () => setEpisode(item.number) }, `第 ${item.number} 集 · ${item.title} · ${status}`)
        })),
        h(PlanningView, { key: episode, projectId, step: 'timeline', episode, title: `第 ${episode} 集时间线`, refresh, onChanged: changed })) : h('p', null, '请先定稿剧情总览'))
  }

  function EpisodeStepView({ projectId, kind, viewState = {}, onViewState = () => {} }) {
    const [planning, setPlanning] = useState(null), [episode, setEpisode] = useState(viewState.episode || 1)
    const [tab, setTab] = useState(viewState.episodeTab === 'shot-prompt' ? 'shot-prompt' : 'storyboard'), [shotId, setShotId] = useState('')
    const [project, setProject] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { readPlanning(projectId).then(setPlanning).catch(err => setError(err.message)) }, [projectId])
    useEffect(() => { let active = true; fetchEpisode(projectId, episode).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, episode])
    useEffect(() => {
      if (kind !== 'film' || !['pending', 'running'].includes(project?.film_task?.status)) return
      let active = true, timer
      const poll = async () => {
        try { const value = await fetchEpisode(projectId, episode); if (active) setProject(value) }
        catch (err) { if (active) setError(err.message) }
        finally { if (active) timer = setTimeout(poll, 4000) }
      }
      timer = setTimeout(poll, 4000)
      return () => { active = false; clearTimeout(timer) }
    }, [projectId, episode, project?.film_task?.status, kind])
    const storyboard = planning?.episodes?.[episode]?.storyboard
    const shots = finalValue(storyboard)?.shots || []
    const refresh = value => { setPlanning(value); fetchEpisode(projectId, episode).then(setProject).catch(err => setError(err.message)) }
    const remember = patch => onViewState({ ...viewState, ...patch })
    const run = async action => {
      setBusy(true); setError('')
      try { setProject(await action()); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    const actual = project?.acts.flatMap(act => act.shots) || []
    const issue = reviewReason(planning, project, episode) || actual.map(shot => reviewReason(planning, project, episode, shot)).find(Boolean)
    const unaccepted = actual.filter(shot => !shot.accepted).length
    return h('div', { className: 'elysium-episode-planning' },
      h('nav', { 'aria-label': '选择剧集' }, Array.from({ length: episodeCount(planning) }, (_, index) => h('button', { key: index,
        'aria-current': episode === index + 1, onClick: () => { setEpisode(index + 1); setShotId(''); remember({ episode: index + 1 }) } }, `第 ${index + 1} 集`))),
      kind === 'storyboard' ? h('nav', { className: 'elysium-tabs', role: 'tablist', 'aria-label': '分镜步骤' }, [['storyboard', '分镜'], ['shot-prompt', '提示词']].map(([key, label]) =>
        h('button', { key, role: 'tab', 'aria-selected': tab === key, onClick: () => { setTab(key); remember({ episodeTab: key }) } }, label))) : null,
      kind === 'storyboard' && tab === 'shot-prompt' ? h('label', null, '选择镜头', h('select', { 'aria-label': '提示词镜头', value: shotId, onChange: event => setShotId(event.target.value) },
        h('option', { value: '' }, '请选择'), shots.map((shot, index) => h('option', { key: shot.id, value: shot.id }, `镜 ${index + 1} · ${shot.action.slice(0, 20)}`)))) : null,
      kind === 'storyboard' && (tab !== 'shot-prompt' || shotId) ? h(PlanningView, { key: `${episode}-${tab}-${shotId}`, projectId, step: tab, episode,
        shotId: tab === 'shot-prompt' ? shotId : undefined, title: tab === 'storyboard' ? '单集分镜' : '逐镜提示词', onFinalized: refresh }) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      kind === 'storyboard' && project?.acts.length ? h(StoryboardView, { project, episode, busy, run, viewState: viewState.storyboard,
        reviewReason: shot => reviewReason(planning, project, episode, shot), onViewState: value => remember({ storyboard: value }),
        save: patch => run(() => saveEpisode(projectId, episode, patch.acts)) }) : null,
      kind === 'film' ? h('div', null,
        project?.film_task ? h('p', { role: 'status' }, { pending: '等待合成', running: '正在合成', succeeded: '成片已完成', failed: project.film_task.error || '合成失败' }[project.film_task.status]) : null,
        issue ? h('p', { role: 'status' }, issue) : null,
        unaccepted ? h('p', { role: 'status' }, `还有 ${unaccepted} 个镜头未采用`) : null,
        h('div', { className: 'elysium-film-actions' }, h('button', { type: 'button', className: 'elysium-primary', disabled: busy || Boolean(issue) || Boolean(unaccepted) || ['pending', 'running'].includes(project?.film_task?.status) || !actual.length,
          onClick: () => run(() => composeFilm(projectId, episode)) }, busy ? '正在提交…' : project?.film_task?.status === 'failed' ? '重试合成' : '合成本集')),
        project?.deliverables?.length ? h(DeliveryView, { project }) : null) : null)
  }
  const StoryboardStepView = props => h(EpisodeStepView, { ...props, kind: 'storyboard' })
  const FilmStepView = props => h(EpisodeStepView, { ...props, kind: 'film' })
  Object.assign(exports, { PlanningView, ScriptView, StoryboardStepView, FilmStepView })
  return exports
} })
