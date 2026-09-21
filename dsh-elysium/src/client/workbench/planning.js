// 职责：让运营查看、重新生成、手改与定稿剧情规划的各个版本。
window.__ModuleLoader__.load({ id: 'elysium/planning', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { readPlanning, generatePlanning, editPlanning, finalizePlanning, fetchEpisode } = require('elysium/project-api')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const labels = { logline: '一句话梗概', genre: '题材', episode_count: '集数', episode_seconds: '单集秒数', world: '世界观',
    characters: '角色', scenes: '场景', id: '标识', name: '名称', appearance: '外观', voice: '音色', personality: '性格', image_prompt: '出图提示词（英文）',
    episodes: '分集剧情', number: '集号', title: '标题', summary: '梗概', hook: '结尾钩子',
    beats: '时间线', start: '开始秒数', end: '结束秒数', plot: '情节', emotion: '情绪', tone: '语气',
    scene_id: '场景', roles: '人物', action: '动作', dialogue: '对白', role: '说话角色', text: '台词',
    shots: '镜头', shot_size: '景别', camera: '运镜', duration: '秒数', prompt: '视频提示词', keyframe_prompt: '首帧提示词（英文）' }
  const defaults = { characters: { id: '', name: '', appearance: '', voice: '', personality: '', image_prompt: '' },
    scenes: { id: '', name: '', description: '' }, episodes: { number: 1, title: '', summary: '', hook: '' },
    beats: { start: 0, end: 10, scene_id: '', roles: [], plot: '', emotion: '', dialogue: [] },
    dialogue: { role: '', text: '', tone: '' }, shots: { scene_id: '', roles: [], shot_size: '', camera: '', action: '', duration: 5, dialogue: [] } }
  const copy = value => JSON.parse(JSON.stringify(value))

  function AutoGenerateButton({ busy, disabled, onClick }) {
    return h('button', { type: 'button', className: 'elysium-primary', 'aria-label': '机器人自动生成', disabled: busy || disabled, onClick }, busy ? '🤖 生成中…' : '🤖 自动生成')
  }

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
    const multiline = ['prompt', 'keyframe_prompt', 'image_prompt', 'world', 'action', 'appearance', 'description', 'plot', 'summary'].includes(name)
    return h('label', { className: 'elysium-field' }, h('span', null, label),
      multiline ? h('textarea', { 'aria-label': field, rows: name === 'prompt' ? 14 : 3, value: value ?? '', onChange: event => onChange(event.target.value) })
        : h('input', { 'aria-label': field, type: numeric ? 'number' : 'text', value: value ?? '',
          onChange: event => onChange(numeric ? Number(event.target.value) : event.target.value) }))
  }

  function PlanningView({ projectId, step, episode, shotId, title, onFinalized, onChanged, refresh = 0 }) {
    const [planning, setPlanning] = useState(null), [version, setVersion] = useState(0)
    const [draft, setDraft] = useState(null), [requirements, setRequirements] = useState('')
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), editing = useRef(false)
    // 项目有新变更时刷新版本；正在编辑或提交时保留草稿。
    useEffect(() => { if (editing.current) return; let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, refresh])
    const entry = step === 'series' ? planning?.[step]
      : step === 'shot-prompt' ? planning?.episodes?.[episode]?.prompts?.[shotId] : planning?.episodes?.[episode]?.[step]
    const selected = entry?.versions.find(item => item.version === (version || entry.versions.at(-1)?.version))
    const unsaved = Boolean(draft && selected && JSON.stringify(draft) !== JSON.stringify(selected.value))
    editing.current = unsaved || busy
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
        h(AutoGenerateButton, { busy, onClick: async () => { const value = await run(() => generatePlanning(projectId, step, episode, shotId, requirements)); if (value) { setVersion(0); setRequirements('') } } }),
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
  function reviewReason(planning, project, episode) {
    const entry = planning?.episodes?.[episode]
    if (!planning?.series?.finalized) return ''
    if (!entry?.timeline?.finalized || entry.timeline.needs_review) return '本集时间线待定稿或需复核'
    if (!entry.storyboard?.finalized || entry.storyboard.needs_review) return '本集分镜待定稿或需复核'
    const shot = (project?.acts.flatMap(act => act.shots) || []).find(item => !item.prompt_finalized || entry.prompts?.[item.id]?.needs_review)
    return shot ? `镜头 ${shot.id} 提示词待定稿或需复核` : ''
  }

  function ScriptView({ projectId, refresh = 0, initialEpisode = 1, onChanged = () => {} }) {
    const [planning, setPlanning] = useState(null), [episode, setEpisode] = useState(initialEpisode)
    const [error, setError] = useState('')
    useEffect(() => { readPlanning(projectId).then(setPlanning).catch(err => setError(err.message)) }, [projectId, refresh])
    const series = finalValue(planning?.series)
    const changed = value => { setPlanning(value); onChanged(value) }
    return h('div', { className: 'elysium-script-view' },
      h(PlanningView, { projectId, step: 'series', title: '剧情总览', refresh, onChanged: changed }),
      error ? h('p', { role: 'alert' }, error) : null,
      series ? h('section', { className: 'elysium-timeline-list' }, h('div', { className: 'elysium-section-heading' }, h('h2', null, '分集时间线')),
        h('div', { className: 'elysium-timeline-episodes' }, series.episodes.map(item => {
          const entry = planning?.episodes?.[item.number]?.timeline
          const status = entry?.needs_review ? '需复核' : entry?.finalized ? '已定稿' : entry?.versions.length ? '草稿' : '未生成'
          return h('button', { type: 'button', key: item.number, 'aria-current': episode === item.number, onClick: () => setEpisode(item.number) }, `第 ${item.number} 集 · ${item.title} · ${status}`)
        })),
        h(PlanningView, { key: episode, projectId, step: 'timeline', episode, title: `第 ${episode} 集时间线`, refresh, onChanged: changed })) : h('p', null, '定稿剧情总览后，一键生产会自动生成各集时间线'))
  }

  // 分镜页：按集查看规划与镜头画面；成片页：查看本集合成状态与交付物。数据随项目变更自动刷新。
  function EpisodeStepView({ projectId, kind, refresh = 0, viewState = {}, onViewState = () => {} }) {
    const [planning, setPlanning] = useState(null), [episode, setEpisode] = useState(viewState.episode || 1)
    const [tab, setTab] = useState(viewState.episodeTab === 'shot-prompt' ? 'shot-prompt' : 'storyboard'), [shotId, setShotId] = useState(viewState.shot_id || '')
    const [project, setProject] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { readPlanning(projectId).then(setPlanning).catch(err => setError(err.message)) }, [projectId, refresh])
    useEffect(() => { let active = true; fetchEpisode(projectId, episode).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, episode, refresh])
    const shots = finalValue(planning?.episodes?.[episode]?.storyboard)?.shots || []
    const reload = value => { setPlanning(value); fetchEpisode(projectId, episode).then(setProject).catch(err => setError(err.message)) }
    const remember = patch => onViewState({ ...viewState, ...patch })
    const run = async action => {
      setBusy(true); setError('')
      try { setProject(await action()); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    const issue = reviewReason(planning, project, episode), film = project?.film_task
    return h('div', { className: 'elysium-episode-planning' },
      h('nav', { 'aria-label': '选择剧集' }, Array.from({ length: episodeCount(planning) }, (_, index) => h('button', { key: index,
        'aria-current': episode === index + 1, onClick: () => { setEpisode(index + 1); setShotId(''); remember({ episode: index + 1 }) } }, `第 ${index + 1} 集`))),
      kind === 'storyboard' ? h('nav', { className: 'elysium-tabs', role: 'tablist', 'aria-label': '分镜步骤' }, [['storyboard', '分镜'], ['shot-prompt', '提示词']].map(([key, label]) =>
        h('button', { key, role: 'tab', 'aria-selected': tab === key, onClick: () => { setTab(key); remember({ episodeTab: key }) } }, label))) : null,
      kind === 'storyboard' && tab === 'shot-prompt' ? h('label', null, '选择镜头', h('select', { 'aria-label': '提示词镜头', value: shotId, onChange: event => setShotId(event.target.value) },
        h('option', { value: '' }, '请选择'), shots.map((shot, index) => h('option', { key: shot.id, value: shot.id }, `镜 ${index + 1} · ${shot.action.slice(0, 20)}`)))) : null,
      kind === 'storyboard' && (tab !== 'shot-prompt' || shotId) ? h(PlanningView, { key: `${episode}-${tab}-${shotId}`, projectId, step: tab, episode, refresh,
        shotId: tab === 'shot-prompt' ? shotId : undefined, title: tab === 'storyboard' ? '单集分镜' : '逐镜提示词', onFinalized: reload }) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      kind === 'storyboard' && project?.acts.length ? h(StoryboardView, { key: episode, project, episode, busy, run, viewState: viewState.storyboard,
        onViewState: value => remember({ storyboard: value }) }) : null,
      kind === 'film' ? h('div', null,
        film ? h('p', { role: film.status === 'failed' ? 'alert' : 'status' }, { pending: '等待合成', running: '正在合成', succeeded: '本集成片已完成', failed: `合成失败：${film.error || ''}` }[film.status])
          : h('p', { role: 'status' }, issue || '本集镜头全部完成后自动合成'),
        project?.deliverables?.length ? h(DeliveryView, { project }) : null) : null)
  }
  const StoryboardStepView = props => h(EpisodeStepView, { ...props, kind: 'storyboard' })
  const FilmStepView = props => h(EpisodeStepView, { ...props, kind: 'film' })
  Object.assign(exports, { AutoGenerateButton, PlanningView, ScriptView, StoryboardStepView, FilmStepView })
  return exports
} })
