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
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [generatedVersion, setGeneratedVersion] = useState(null), editing = useRef(false)
    // 项目有新变更时刷新版本；正在编辑或提交时保留草稿。
    useEffect(() => { if (editing.current) return; let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, refresh])
    const entryFor = value => step === 'series' ? value?.[step]
      : step === 'shot-prompt' ? value?.episodes?.[episode]?.prompts?.[shotId] : value?.episodes?.[episode]?.[step]
    const entry = entryFor(planning)
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
        h(AutoGenerateButton, { busy, onClick: async () => { setGeneratedVersion(null); const value = await run(() => generatePlanning(projectId, step, episode, shotId, requirements)); if (value) { setVersion(0); setRequirements(''); setGeneratedVersion(entryFor(value)?.versions.at(-1)?.version) } } }),
        generatedVersion ? h('span', { role: 'status' }, `已生成第 ${generatedVersion} 版，请查看上方内容`) : null,
        error ? h('span', { role: 'alert' }, error) : null,
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
  const seriesFields = {
    '故事主线': { logline: '一句话梗概', genre: '题材', episode_count: '集数', episode_seconds: '单集秒数', world: '世界观' },
    '角色': { id: '标识', name: '名称', appearance: '外观', voice: '音色', personality: '性格', image_prompt: '出图提示词' },
    '场景': { id: '标识', name: '名称', description: '描述' },
    '分集': { number: '集号', title: '标题', summary: '梗概', hook: '结尾钩子' },
  }
  const escapeSeries = value => String(value ?? '').replace(/^([#\\])/gm, '\\$1')
  const unescapeSeries = value => value.replace(/^\\([#\\])/gm, '$1')
  const seriesBlock = (value, fields, level) => Object.entries(fields).map(([key, label]) => `${'#'.repeat(level)} ${label}\n${escapeSeries(value[key])}`).join('\n\n')
  function formatSeries(value) {
    return ['# 剧情总览', `## 故事主线\n\n${seriesBlock(value, seriesFields['故事主线'], 3)}`,
      ...[['角色', 'characters'], ['场景', 'scenes'], ['分集', 'episodes']].map(([label, key]) =>
        [`## ${label} · ${value[key].length}`, ...value[key].map((item, index) => `### ${label} ${index + 1}\n\n${seriesBlock(item, seriesFields[label], 4)}`)].join('\n\n'))].join('\n\n')
  }
  function parseSeries(source) {
    const text = source.replace(/\r\n/g, '\n')
    if (!text.startsWith('# 剧情总览\n\n')) throw new Error('剧情总览需要「# 剧情总览」标题')
    const headings = [...text.matchAll(/^([#]{2,4}) ([^\n]+)$/gm)], value = {}, seen = new Set()
    if (!headings.length || text.slice('# 剧情总览\n\n'.length, headings[0].index).trim()) throw new Error('剧情总览需要分区标题')
    let group, item
    for (let index = 0; index < headings.length; index++) {
      const [, marks, title] = headings[index], level = marks.length
      const start = headings[index].index + headings[index][0].length + 1
      const end = index + 1 < headings.length ? Math.max(start, headings[index + 1].index - 2) : text.length
      const content = unescapeSeries(text.slice(start, end))
      if ((level === 2 || level === 3 && group !== '故事主线') && content.trim()) throw new Error(`请把内容写在字段标题下：${title}`)
      if (level === 2) {
        group = title === '故事主线' ? title : ['角色', '场景', '分集'].find(label => new RegExp(`^${label} · \\d+$`).test(title))
        if (!group || seen.has(group)) throw new Error(`剧情总览分区无效：${title}`)
        seen.add(group); item = null
        if (group !== '故事主线') value[{ 角色: 'characters', 场景: 'scenes', 分集: 'episodes' }[group]] = []
      } else if (level === 3 && group !== '故事主线') {
        const key = { 角色: 'characters', 场景: 'scenes', 分集: 'episodes' }[group]
        if (!key || title !== `${group} ${value[key].length + 1}`) throw new Error(`剧情总览条目无效：${title}`)
        item = {}; value[key].push(item)
      } else {
        const fields = seriesFields[group], target = level === 3 && group === '故事主线' ? value : level === 4 ? item : null
        const key = fields && Object.keys(fields).find(name => fields[name] === title)
        if (!target || !key || Object.hasOwn(target, key)) throw new Error(`剧情总览字段无效：${title}`)
        target[key] = ['episode_count', 'episode_seconds', 'number'].includes(key) ? Number(content) : content
      }
    }
    for (const [label, fields] of Object.entries(seriesFields)) {
      const items = label === '故事主线' ? [value] : value[{ 角色: 'characters', 场景: 'scenes', 分集: 'episodes' }[label]]
      if (!items || items.some(item => Object.keys(fields).some(key => !Object.hasOwn(item, key)))) throw new Error(`剧情总览缺少${label}字段`)
    }
    return value
  }
  const encode = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[｜、：（）]/g, match => `\\${match}`)
  const decode = value => value.replace(/\\(n|.)/g, (_, char) => char === 'n' ? '\n' : char)
  function splitRaw(value, separator) {
    const parts = ['']
    for (let index = 0; index < value.length; index++) {
      const char = value[index]
      if (char === '\\' && index + 1 < value.length) { parts[parts.length - 1] += char + value[++index]; continue }
      if (char === separator) parts.push('')
      else parts[parts.length - 1] += char
    }
    return parts
  }
  const clock = value => { const minute = Math.floor(value / 60); return `${String(minute).padStart(2, '0')}:${String(Number((value - minute * 60).toFixed(9))).padStart(2, '0')}` }
  const seconds = value => { const [, minute, second] = value.match(/^(\d+):(\d{2}(?:\.\d+)?)$/) || []; return minute === undefined || Number(second) >= 60 ? null : Number(minute) * 60 + Number(second) }
  function names(items) {
    const counts = new Map()
    items.forEach(item => counts.set(item.name, (counts.get(item.name) || 0) + 1))
    return items.map(item => ({ id: item.id, label: counts.get(item.name) > 1 ? `${item.name} #${item.id}` : item.name }))
  }
  function formatTimeline(value, series) {
    const scenes = names(series.scenes), roles = names(series.characters)
    const label = (items, id) => encode(items.find(item => item.id === id)?.label || id)
    return value.beats.map(beat => [
      `${clock(beat.start)}-${clock(beat.end)}｜${label(scenes, beat.scene_id)}｜${beat.roles.map(id => label(roles, id)).join('、')}`,
      `情节：${encode(beat.plot)}`, `情绪：${encode(beat.emotion)}`, '对白：',
      ...(beat.dialogue.length ? beat.dialogue.map(item => `${label(roles, item.role)}（${encode(item.tone)}）：${encode(item.text)}`) : ['无'])
    ].join('\n')).join('\n\n')
  }
  function parseTimeline(source, series) {
    const scenes = names(series.scenes), roles = names(series.characters), lines = source.replace(/\r\n/g, '\n').split('\n'), beats = []
    const fail = (line, message) => { throw new Error(`第 ${line} 行：${message}`) }
    const resolve = (items, raw, line) => { const label = decode(raw), item = items.find(value => value.label === label); if (!item) fail(line, `未找到「${label}」`); return item.id }
    let index = 0
    while (index < lines.length) {
      if (!lines[index].trim()) { index++; continue }
      const line = index + 1, header = splitRaw(lines[index++], '｜')
      if (header.length !== 3) fail(line, '需要「开始-结束｜场景｜人物」')
      const span = header[0].match(/^(\d+:\d{2}(?:\.\d+)?)-(\d+:\d{2}(?:\.\d+)?)$/)
      const start = span && seconds(span[1]), end = span && seconds(span[2])
      if (start === null || end === null || !span || end <= start) fail(line, '时间范围无效')
      if (start !== (beats.at(-1)?.end || 0)) fail(line, '时间段必须从上一段结束处连续开始')
      const scene_id = resolve(scenes, header[1], line)
      const persons = splitRaw(header[2], '、')
      if (!header[2]) fail(line, '人物不能为空')
      const beatRoles = persons.map(person => resolve(roles, person, line))
      const field = (prefix, message) => { const number = index + 1, value = lines[index++]; if (!value?.startsWith(prefix)) fail(number, message); return decode(value.slice(prefix.length)) }
      const plot = field('情节：', '需要「情节：」'), emotion = field('情绪：', '需要「情绪：」')
      if (!plot.trim() || !emotion.trim()) fail(index, '情节和情绪不能为空')
      if (lines[index++] !== '对白：') fail(index, '需要「对白：」')
      const dialogue = []
      if (lines[index] === '无') index++
      else while (index < lines.length && lines[index].trim()) {
        const number = index + 1, raw = lines[index++], speech = splitRaw(raw, '：')
        if (speech.length !== 2) fail(number, '对白需要「人物（语气）：台词」')
        const person = splitRaw(speech[0], '（')
        if (person.length !== 2 || !person[1].endsWith('）')) fail(number, '对白需要「人物（语气）：台词」')
        const tone = decode(person[1].slice(0, -1)), text = decode(speech[1])
        if (!tone.trim() || !text.trim()) fail(number, '语气和台词不能为空')
        dialogue.push({ role: resolve(roles, person[0], number), tone, text })
      }
      beats.push({ start, end, scene_id, roles: beatRoles, plot, emotion, dialogue })
      if (index < lines.length && lines[index].trim()) fail(index + 1, '时间段之间需要空行')
    }
    if (!beats.length) fail(1, '至少需要一个时间段')
    if (Math.abs(beats.at(-1).end - series.episode_seconds) > series.episode_seconds * 0.1) fail(lines.length, `结束时间需接近 ${series.episode_seconds} 秒`)
    return { beats }
  }
  function formatStoryboard(value, series) {
    const scenes = names(series.scenes), roles = names(series.characters)
    const label = (items, id) => encode(items.find(item => item.id === id)?.label || id)
    return ['# 单集分镜', ...value.shots.map((shot, index) => [
      `## 镜头 ${index + 1}`, `场景：${label(scenes, shot.scene_id)}`,
      `人物：${shot.roles.length ? shot.roles.map(id => label(roles, id)).join('、') : '无'}`,
      `景别：${encode(shot.shot_size)}`, `运镜：${encode(shot.camera)}`,
      `动作：${encode(shot.action)}`, `时长：${shot.duration}`, '对白：',
      ...(shot.dialogue.length ? shot.dialogue.map(line => `${label(roles, line.role)}：${encode(line.text)}`) : ['无'])
    ].join('\n'))].join('\n\n')
  }
  function parseStoryboard(source, series) {
    const scenes = names(series.scenes), roles = names(series.characters)
    const lines = source.replace(/\r\n/g, '\n').trimEnd().split('\n'), shots = []
    const fail = (line, message) => { throw new Error(`第 ${line} 行：${message}`) }
    const resolve = (items, raw, line) => { const label = decode(raw), item = items.find(value => value.label === label); if (!item) fail(line, `未找到「${label}」`); return item.id }
    if (lines[0] !== '# 单集分镜') fail(1, '需要「# 单集分镜」标题')
    let index = 1
    while (index < lines.length) {
      if (!lines[index].trim()) { index++; continue }
      if (lines[index++] !== `## 镜头 ${shots.length + 1}`) fail(index, '镜头标题或顺序无效')
      const field = (prefix, message) => { const line = index + 1, value = lines[index++]; if (!value?.startsWith(prefix)) fail(line, message); return value.slice(prefix.length) }
      const scene_id = resolve(scenes, field('场景：', '需要「场景：」'), index)
      const persons = field('人物：', '需要「人物：」')
      const shotRoles = persons === '无' ? [] : splitRaw(persons, '、').map(person => resolve(roles, person, index))
      const shot_size = decode(field('景别：', '需要「景别：」'))
      const camera = decode(field('运镜：', '需要「运镜：」'))
      const action = decode(field('动作：', '需要「动作：」'))
      const durationRaw = field('时长：', '需要「时长：」'), duration = Number(durationRaw)
      if (!/^\d+$/.test(durationRaw)) fail(index, '时长需要整数秒数')
      if (lines[index++] !== '对白：') fail(index, '需要「对白：」')
      const dialogue = []
      if (lines[index] === '无') index++
      else while (index < lines.length && lines[index].trim()) {
        const line = index + 1, speech = splitRaw(lines[index++], '：')
        if (speech.length !== 2) fail(line, '对白需要「人物：台词」')
        dialogue.push({ role: resolve(roles, speech[0], line), text: decode(speech[1]) })
      }
      shots.push({ scene_id, roles: shotRoles, shot_size, camera, action, duration, dialogue })
      if (index < lines.length && lines[index].trim()) fail(index + 1, '镜头之间需要空行')
    }
    if (!shots.length) fail(2, '至少需要一个镜头')
    return { shots }
  }

  function StoryboardEditor({ projectId, episode, refresh, onSaved }) {
    const [planning, setPlanning] = useState(null), [body, setBody] = useState('')
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
    const editing = useRef(false)
    useEffect(() => { if (editing.current) return; let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, refresh])
    const series = finalValue(planning?.series), entry = planning?.episodes?.[episode]?.storyboard
    const selected = entry?.versions.find(item => item.version === entry.finalized) || entry?.versions.at(-1)
    const source = selected && series ? formatStoryboard(selected.value, series) : ''
    const unsaved = body !== source, saveNeeded = unsaved || !entry?.finalized || entry?.needs_review
    editing.current = unsaved || busy
    useEffect(() => { setBody(source); setError('') }, [selected?.version, episode])
    const run = async operation => {
      setBusy(true); setError(''); setMessage('')
      try { const value = await operation(); setPlanning(value); onSaved(value); return value }
      catch (err) { setError(err.message); return null }
      finally { setBusy(false) }
    }
    return h('section', { className: 'elysium-planning' },
      h('h2', null, '单集分镜'),
      entry?.needs_review ? h('p', { role: 'status' }, '上游内容已变化，请重新生成或保存分镜') : null,
      h('div', { className: 'elysium-planning-actions' },
        h(AutoGenerateButton, { busy, onClick: async () => {
          if (unsaved && !window.confirm('当前分镜有未保存修改，确定重新生成吗？')) return
          if (await run(() => generatePlanning(projectId, 'storyboard', episode, undefined, '', true))) setMessage('已生成单集分镜')
        } }),
        h('button', { type: 'button', className: 'elysium-primary', disabled: busy || !body.trim() || !saveNeeded, onClick: async () => {
          let value
          try { value = parseStoryboard(body, series) } catch (err) { setError(err.message); return }
          await run(() => editPlanning(projectId, 'storyboard', episode, undefined, value, true))
        } }, '保存')),
      message ? h('p', { role: 'status' }, message) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      h('textarea', { 'aria-label': '单集分镜正文', rows: 28, value: body, disabled: busy, onChange: event => setBody(event.target.value) }))
  }
  function reviewReason(planning, project, episode) {
    const currentShots = project?.acts.flatMap(act => act.shots) || []
    if (currentShots.length && currentShots.every(shot => shot.status === 'succeeded' && shot.job_id)) return ''
    const entry = planning?.episodes?.[episode]
    if (!planning?.series?.finalized) return ''
    if (!entry?.timeline?.finalized || entry.timeline.needs_review) return '本集时间线待定稿或需复核'
    if (!entry.storyboard?.finalized || entry.storyboard.needs_review) return '本集分镜待定稿或需复核'
    const shot = currentShots.find(item => !item.prompt_finalized || entry.prompts?.[item.id]?.needs_review)
    return shot ? `镜头 ${shot.id} 提示词待定稿或需复核` : ''
  }

  function ScriptView({ projectId, projectDetails = '', refresh = 0, viewState = {}, onViewState = () => {}, guard, onChanged = () => {} }) {
    const [planning, setPlanning] = useState(null), [tab, setTab] = useState(viewState.scriptTab === 'timeline' ? 'timeline' : 'series')
    const [episode, setEpisode] = useState(viewState.episode || 1), [mobileSelected, setMobileSelected] = useState(false)
    const [seriesText, setSeriesText] = useState(projectDetails), [body, setBody] = useState('')
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
    const dirty = useRef(false)
    useEffect(() => { if (dirty.current) return; let active = true; readPlanning(projectId).then(value => { if (active) setPlanning(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [projectId, refresh])
    const seriesEntry = planning?.series, series = seriesEntry?.versions.at(-1)?.value || finalValue(seriesEntry)
    const entry = tab === 'series' ? seriesEntry : planning?.episodes?.[episode]?.timeline
    const selected = entry?.versions.at(-1)
    const unsaved = tab === 'series' ? seriesText !== (selected ? formatSeries(selected.value) : projectDetails) : body !== (selected && series ? formatTimeline(selected.value, series) : '')
    dirty.current = unsaved || busy
    useEffect(() => { setSeriesText(selected && tab === 'series' ? formatSeries(selected.value) : projectDetails); setBody(selected && tab === 'timeline' && series ? formatTimeline(selected.value, series) : ''); setError('') }, [selected?.version, tab, episode])
    useEffect(() => { if (!guard) return; guard.current = unsaved ? action => { if (window.confirm('当前剧本有未保存修改，确定离开吗？')) action() } : null; return () => { guard.current = null } }, [guard, unsaved])
    const switchTo = action => { if (unsaved && !window.confirm('当前剧本有未保存修改，确定切换吗？')) return; setMessage(''); action() }
    const changed = value => { setPlanning(value); onChanged(value) }
    const run = async operation => { setBusy(true); setError(''); try { const value = await operation(); changed(value); return value } catch (err) { setError(err.message); return null } finally { setBusy(false) } }
    const chooseTab = value => switchTo(() => { setTab(value); onViewState({ ...viewState, scriptTab: value }) })
    const chooseEpisode = number => switchTo(() => { setEpisode(number); setMobileSelected(true); onViewState({ ...viewState, episode: number }) })
    const currentEpisode = series?.episodes.find(item => item.number === episode)
    const status = item => item?.versions.length ? '已生成' : '未生成'
    return h('div', { className: 'elysium-script-view' },
      h('nav', { className: 'elysium-tabs elysium-script-tabs', role: 'tablist', 'aria-label': '剧本内容' },
        [['series', '剧情总览'], ['timeline', '分集时间线']].map(([key, label]) => h('button', { key, type: 'button', role: 'tab', 'aria-selected': tab === key, onClick: () => chooseTab(key) }, label))),
      h('div', { className: 'elysium-script-controls' },
        h(AutoGenerateButton, { busy, onClick: async () => {
          if (selected && unsaved && !window.confirm('当前剧本有未保存修改，确定重新生成吗？')) return
          setMessage('')
          const request = tab === 'series' && !selected && seriesText !== projectDetails ? seriesText : ''
          if (await run(async () => {
            if (tab === 'timeline' && !series) await generatePlanning(projectId, 'series', undefined, undefined, projectDetails, true)
            return generatePlanning(projectId, tab, tab === 'timeline' ? episode : undefined, undefined, request, true)
          })) setMessage(tab === 'series' ? '已生成剧情总览' : `已生成第 ${episode} 集时间线`)
        } }),
        selected ? h('button', { type: 'button', className: 'elysium-primary', disabled: busy || !unsaved, onClick: async () => {
          setMessage('')
          let value
          try { value = tab === 'series' ? parseSeries(seriesText) : parseTimeline(body, series) } catch (err) { setError(err.message); return }
          await run(() => editPlanning(projectId, tab, tab === 'timeline' ? episode : undefined, undefined, value, true))
        } }, '保存') : null),
      message ? h('p', { role: 'status' }, message) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      tab === 'series' ? h('textarea', { className: 'elysium-script-summary', 'aria-label': '剧情总览正文', value: seriesText, rows: 28, disabled: busy, onChange: event => setSeriesText(event.target.value) })
        : series ? h('div', { className: 'elysium-script-episodes', 'data-mobile-selected': mobileSelected },
          h('nav', { 'aria-label': '选择剧集', className: 'elysium-script-directory' }, series.episodes.map(item => {
            const itemEntry = planning?.episodes?.[item.number]?.timeline
            return h('button', { type: 'button', key: item.number, 'aria-current': episode === item.number, onClick: () => chooseEpisode(item.number) },
              h('strong', null, String(item.number).padStart(2, '0')), h('span', null, item.title), h('small', null, status(itemEntry)))
          })),
          h('section', { className: 'elysium-script-episode' },
            h('button', { type: 'button', className: 'elysium-script-back', onClick: () => switchTo(() => setMobileSelected(false)) }, '返回分集目录'),
            h('h3', null, `第 ${episode} 集 · ${currentEpisode?.title || ''}`),
            h('p', null, currentEpisode?.summary), h('p', null, `结尾钩子：${currentEpisode?.hook || '—'}`),
            h('textarea', { className: 'elysium-script-body', 'aria-label': '本集剧本', value: body, rows: 24, disabled: busy, onChange: event => setBody(event.target.value) }))) : null)
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
      h('nav', { className: 'elysium-episode-selector', 'aria-label': '选择剧集' }, Array.from({ length: episodeCount(planning) }, (_, index) => {
        const item = project?.episodes.find(value => value.number === index + 1), itemShots = item?.acts.flatMap(act => act.shots) || []
        const complete = kind === 'film' ? item?.deliverables.some(value => value.type === 'film') : itemShots.length && itemShots.every(shot => shot.status === 'succeeded')
        const progress = kind === 'film' ? Boolean(item?.film_task || itemShots.some(shot => shot.status === 'succeeded')) : Boolean(itemShots.length)
        return h('button', { key: index, 'data-complete': complete || undefined, 'data-progress': !complete && progress || undefined,
          'aria-current': episode === index + 1, onClick: () => { setEpisode(index + 1); setShotId(''); remember({ episode: index + 1 }) } }, `第 ${index + 1} 集`)
      })),
      kind === 'storyboard' ? h('nav', { className: 'elysium-tabs', role: 'tablist', 'aria-label': '分镜步骤' }, [['storyboard', '分镜'], ['shot-prompt', '提示词']].map(([key, label]) =>
        h('button', { key, role: 'tab', 'aria-selected': tab === key, onClick: () => { setTab(key); remember({ episodeTab: key }) } }, label))) : null,
      kind === 'storyboard' && tab === 'shot-prompt' ? h('label', null, '选择镜头', h('select', { 'aria-label': '提示词镜头', value: shotId, onChange: event => setShotId(event.target.value) },
        h('option', { value: '' }, '请选择'), shots.map((shot, index) => h('option', { key: shot.id, value: shot.id }, `镜 ${index + 1} · ${shot.action.slice(0, 20)}`)))) : null,
      kind === 'storyboard' && tab === 'storyboard' ? h(StoryboardEditor, { key: `${episode}-editor`, projectId, episode, refresh, onSaved: reload }) : null,
      kind === 'storyboard' && tab === 'shot-prompt' && shotId ? h(PlanningView, { key: `${episode}-${tab}-${shotId}`, projectId, step: tab, episode, refresh,
        shotId, title: '逐镜提示词', onFinalized: reload }) : null,
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
  Object.assign(exports, { AutoGenerateButton, PlanningView, ScriptView, StoryboardStepView, FilmStepView, formatSeries, parseSeries, formatTimeline, parseTimeline, formatStoryboard, parseStoryboard })
  return exports
} })
