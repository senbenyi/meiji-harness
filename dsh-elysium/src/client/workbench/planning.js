// 职责：让运营查看、重新生成、手改与定稿剧情规划的各个版本。
window.__ModuleLoader__.load({ id: 'elysium/planning', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { readPlanning, generatePlanning, editPlanning, finalizePlanning, fetchEpisode, saveEpisode, composeFilm } = require('elysium/project-api')
  const { StoryboardView } = require('elysium/storyboard')
  const { DeliveryView } = require('elysium/delivery')
  const labels = { logline: '一句话梗概', genre: '题材', episode_count: '集数', episode_seconds: '单集秒数', world: '世界观',
    characters: '角色', scenes: '场景', id: '标识', name: '名称', appearance: '外观', voice: '音色', personality: '性格',
    episodes: '分集大纲', number: '集号', title: '标题', conflict: '冲突', turn: '转折', hook: '结尾钩子',
    scene_id: '场景', roles: '人物', action: '动作', dialogue: '对白', role: '说话角色', text: '台词',
    shots: '镜头', shot_size: '景别', camera: '运镜', duration: '秒数', prompt: '视频提示词' }
  const defaults = { characters: { id: '', name: '', appearance: '', voice: '', personality: '' },
    scenes: { id: '', name: '', description: '' }, episodes: { number: 1, title: '', conflict: '', turn: '', hook: '' },
    dialogue: { role: '', text: '' }, shots: { scene_id: '', roles: [], shot_size: '', camera: '', action: '', duration: 5, dialogue: [] } }
  const copy = value => JSON.parse(JSON.stringify(value))

  function Field({ name, value, onChange, path = '' }) {
    const label = labels[name] || name, field = path ? `${path} · ${label}` : label
    if (Array.isArray(value)) return h('fieldset', { className: 'elysium-planning-array' },
      h('legend', null, label),
      value.map((item, index) => h('div', { key: index, className: 'elysium-planning-item' },
        h(Field, { name: `${label} ${index + 1}`, value: item, path: field, onChange: next => onChange(value.map((old, i) => i === index ? next : old)) }),
        h('button', { type: 'button', onClick: () => onChange(value.filter((_, i) => i !== index)) }, `删除${label} ${index + 1}`))),
      h('button', { type: 'button', onClick: () => onChange([...value, copy(defaults[name] ?? (typeof value[0] === 'string' ? '' : value[0] || ''))]) }, `添加${label}`))
    if (value && typeof value === 'object') return h('div', { className: 'elysium-planning-fields' },
      Object.entries(value).map(([key, item]) => h(Field, { key, name: key, value: item, path: field,
        onChange: next => onChange({ ...value, [key]: next }) })))
    const numeric = typeof value === 'number'
    const multiline = name === 'prompt' || name === 'world' || name === 'action' || name === 'appearance' || name === 'description'
    return h('label', { className: 'elysium-field' }, h('span', null, label),
      multiline ? h('textarea', { 'aria-label': field, rows: name === 'prompt' ? 14 : 3, value: value ?? '', onChange: event => onChange(event.target.value) })
        : h('input', { 'aria-label': field, type: numeric ? 'number' : 'text', value: value ?? '',
          onChange: event => onChange(numeric ? Number(event.target.value) : event.target.value) }))
  }

  function PlanningView({ projectId, step, episode, shotId, title, onFinalized }) {
    const [planning, setPlanning] = useState(null), [version, setVersion] = useState(0)
    const [draft, setDraft] = useState(null), [requirements, setRequirements] = useState('')
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId])
    const entry = step === 'series' || step === 'outline' ? planning?.[step]
      : step === 'shot-prompt' ? planning?.episodes?.[episode]?.prompts?.[shotId] : planning?.episodes?.[episode]?.[step]
    const selected = entry?.versions.find(item => item.version === (version || entry.versions.at(-1)?.version))
    useEffect(() => { setDraft(selected ? copy(selected.value) : null) }, [selected?.version, step, episode, shotId])
    async function run(operation) {
      setBusy(true); setError('')
      try {
        const value = await operation()
        setPlanning(value)
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
      h('div', null,
        h('button', { type: 'button', disabled: busy, onClick: async () => { const value = await run(() => generatePlanning(projectId, step, episode, shotId, requirements)); if (value) { setVersion(0); setRequirements('') } } }, selected ? '按补充要求重新生成' : '生成'),
        h('button', { type: 'button', disabled: busy || !draft, onClick: async () => {
          const saved = await run(() => editPlanning(projectId, step, episode, shotId, draft))
          if (saved) setVersion(0)
        } }, '保存修改'),
        h('button', { type: 'button', disabled: busy || !selected, onClick: async () => {
          const value = await run(() => finalizePlanning(projectId, step, episode, shotId, selected.version))
          if (value) onFinalized?.(value)
        } }, '定稿')))
  }

  function EpisodePlanningView({ projectId, viewState = {}, onViewState = () => {} }) {
    const [planning, setPlanning] = useState(null), [episode, setEpisode] = useState(viewState.episode || 1), [tab, setTab] = useState(viewState.episodeTab || 'script')
    const [shotId, setShotId] = useState('')
    const [project, setProject] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { readPlanning(projectId).then(setPlanning).catch(() => {}) }, [projectId])
    useEffect(() => { let active = true; fetchEpisode(projectId, episode).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, episode])
    const count = planning?.series?.versions.find(item => item.version === planning.series.finalized)?.value.episode_count || 1
    const storyboard = planning?.episodes?.[episode]?.storyboard
    const shots = storyboard?.versions.find(item => item.version === storyboard.finalized)?.value.shots || []
    const refresh = value => { setPlanning(value); fetchEpisode(projectId, episode).then(setProject).catch(err => setError(err.message)) }
    const remember = patch => onViewState({ ...viewState, ...patch })
    const run = async action => {
      setBusy(true); setError('')
      try { setProject(await action()); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    return h('div', { className: 'elysium-episode-planning' },
      h('nav', { 'aria-label': '选择剧集' }, Array.from({ length: count }, (_, index) => h('button', { key: index, 'aria-current': episode === index + 1, onClick: () => { setEpisode(index + 1); setShotId(''); remember({ episode: index + 1 }) } }, `第 ${index + 1} 集`))),
      h('nav', { 'aria-label': '剧集步骤' }, [['script', '剧本'], ['storyboard', '分镜'], ['shot-prompt', '提示词'], ['film', '成品']].map(([key, label]) =>
        h('button', { key, 'aria-current': tab === key, onClick: () => { setTab(key); remember({ episodeTab: key }) } }, label))),
      tab === 'shot-prompt' ? h('label', null, '选择镜头', h('select', { 'aria-label': '提示词镜头', value: shotId, onChange: event => setShotId(event.target.value) },
        h('option', { value: '' }, '请选择'), shots.map((shot, index) => h('option', { key: shot.id, value: shot.id }, `镜 ${index + 1} · ${shot.action.slice(0, 20)}`)))) : null,
      tab === 'film' ? null : tab !== 'shot-prompt' || shotId ? h(PlanningView, { key: `${episode}-${tab}-${shotId}`, projectId, step: tab, episode,
        shotId: tab === 'shot-prompt' ? shotId : undefined, title: tab === 'script' ? '单集剧本' : tab === 'storyboard' ? '单集分镜' : '逐镜提示词',
        onFinalized: refresh }) : h('p', null, '请先定稿本集分镜并选择镜头'),
      error ? h('p', { role: 'alert' }, error) : null,
      tab === 'storyboard' && project?.acts.length ? h(StoryboardView, { project, episode, busy, run, viewState: viewState.storyboard,
        onViewState: value => remember({ storyboard: value }),
        save: patch => run(() => saveEpisode(projectId, episode, patch.acts)) }) : null,
      tab === 'film' ? h('div', null,
        h('button', { type: 'button', disabled: busy || !project?.acts.length || project.acts.some(act => act.shots.some(shot => shot.status !== 'succeeded')),
          onClick: () => run(() => composeFilm(projectId, episode)) }, busy ? '正在合成…' : '合成本集'),
        project?.deliverables?.length ? h(DeliveryView, { project }) : null) : null)
  }
  Object.assign(exports, { PlanningView, EpisodePlanningView })
  return exports
} })
