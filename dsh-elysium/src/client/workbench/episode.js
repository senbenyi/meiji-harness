// 职责：在一屏内编辑本集剧本与镜头、查看任务和成片。
window.__ModuleLoader__.load({ id: 'elysium/episode', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { saveDoc, generateDoc, reshootShot, previewShot, composeFilm, produceEpisode } = require('elysium/project-api')
  const { assetUrl } = require('elysium/media-api')
  const { Badge, FullText, FullTextToggle, Menu, useFullText } = require('elysium/dialog')
  const replace = (markdown, index, text) => { const lines = markdown.split('\n'); lines[index] = text; return lines.join('\n') }
  const remove = (markdown, index, count = 1) => { const lines = markdown.split('\n'); lines.splice(index, count); return lines.join('\n') }
  const insert = (markdown, index, text) => { const lines = markdown.split('\n'); lines.splice(index, 0, text); return lines.join('\n') }
  const marker = (id, size = '中景', camera = '固定', duration = 5) => `### [${id}] ${size}｜${camera}｜${duration} 秒\n视频：\n首帧：`
  const nextId = shots => `S${String(Math.max(0, ...shots.map(item => Number(item.id.slice(1)))) + 1).padStart(2, '0')}`
  // 改镜头任一字段都整行重写标记，保留人物。
  const markerOf = (shot, patch) => { const v = { size: shot.size, camera: shot.camera, duration: shot.duration, roles: shot.roles?.join('、') || '', ...patch }; return `### [${shot.id}] ${v.size}｜${v.camera}｜${v.duration} 秒${v.roles.trim() ? `｜人物：${v.roles.trim()}` : ''}` }
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const kindOf = text => text.startsWith('动作：') ? 'action' : text.startsWith('音效：') ? 'sound' : 'dialogue'
  const busy = shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && Boolean(shot.job_id)

  // 分集进度文字与色调：总览分集卡片和分集目录共用。
  function episodeProgress(project, number) {
    const data = project.episodes.find(part => part.number === number), list = data?.shots || [], completed = list.filter(shot => shot.status === 'succeeded').length
    return data?.film ? ['成片 ✓', 'success'] : list.length ? [`画面 ${completed}/${list.length}`, completed ? 'active' : 'muted'] : data?.script?.trim() ? ['待分镜', 'muted'] : ['待写剧本', 'muted']
  }

  // 看起来是正文、点击即可编辑的字段；失焦保存，回车/退格用于增删剧本行。
  function Inline({ label, value, onCommit, multiline = false, width = 48, className = '', placeholder, onEnter, onEmptyBackspace }) {
    const [draft, setDraft] = useState(value || ''), [error, setError] = useState('')
    useEffect(() => { if (document.activeElement?.getAttribute('aria-label') !== label) setDraft(value || '') }, [value])
    const commit = async () => {
      if (draft === value) return
      try { await onCommit(draft); setError('') } catch (err) { setError(err.message) }
    }
    const props = { 'aria-label': label, placeholder, value: draft, className: `elysium-plain ${className}`, onChange: event => setDraft(event.target.value), onBlur: commit,
      onKeyDown: event => {
        if (event.key === 'Enter' && onEnter && !event.shiftKey) { event.preventDefault(); onEnter(draft) }
        if (event.key === 'Backspace' && !draft && onEmptyBackspace) { event.preventDefault(); onEmptyBackspace() }
      } }
    const rows = Math.max(1, Math.ceil((draft.length || 1) / width))
    return h('span', { className: `elysium-inline${error ? ' elysium-inline-error' : ''}` },
      multiline ? h('textarea', { ...props, rows }) : h('input', props), error ? h('small', { role: 'alert' }, error) : null)
  }

  function Thumb({ shot }) {
    const [failed, setFailed] = useState(false), [playing, setPlaying] = useState(false)
    const ready = shot.status === 'succeeded' && shot.job_id
    const image = shot.keyframe_job_id && !failed ? h('img', { src: assetUrl('image', shot.keyframe_job_id), alt: '', onError: () => setFailed(true) }) : null
    if (ready && playing) return h('video', { className: 'elysium-thumb', src: assetUrl('video', shot.job_id), controls: true, autoPlay: true, onEnded: () => setPlaying(false) })
    if (!ready && !image) return null
    return ready ? h('button', { type: 'button', className: 'elysium-thumb', 'aria-label': `播放 ${shot.id}`, onClick: () => setPlaying(true) }, image, h('span', { className: 'elysium-thumb-play' }, '▶'))
      : h('span', { className: 'elysium-thumb', 'data-status': shot.status || 'pending' }, image, h('small', null, busy(shot) ? '生成中' : shot.status === 'failed' ? '失败' : '未生成'))
  }

  // 成片在本集页顶部原地展开，点击镜头跳转并定位到对应卡片。
  function FilmPanel({ film, shots, onClose, focusShot }) {
    const video = useRef(null), [time, setTime] = useState(0)
    let cursor = 0
    const entries = shots.map(shot => { const start = cursor; cursor += shot.duration; return { shot, start, end: cursor } })
    return h('section', { className: 'elysium-film-panel', 'aria-label': '本集成片' },
      h('video', { ref: video, controls: true, autoPlay: true, src: assetUrl('video', film.job_id), onTimeUpdate: event => setTime(event.currentTarget.currentTime) }),
      h('div', { className: 'elysium-film-side' },
      h('header', { className: 'elysium-page-heading' }, h('h3', null, '本集成片'),
        h('a', { href: assetUrl('video', film.job_id), download: true }, '下载视频'),
        film.subtitle_job_id ? h('a', { href: assetUrl('download', film.subtitle_job_id), download: true }, '下载字幕') : null,
        h('button', { type: 'button', onClick: onClose }, '收起')),
      h('ol', { className: 'elysium-film-shots' }, entries.map(({ shot, start, end }) => h('li', { key: shot.id },
        h('button', { type: 'button', 'aria-current': time >= start && time < end ? 'true' : undefined,
          onClick: () => { video.current.currentTime = start; focusShot(shot.id) } }, h('b', null, shot.id), ` ${clock(start)}–${clock(end)}`))))))
  }

  function EpisodeView({ project, episode, selectEpisode, onProject }) {
    const current = project.episodes.find(item => item.number === episode) || { script: '', scenes: [], shots: [], film: null }
    const [markdown, setMarkdown] = useState(current.script), [saving, setSaving] = useState(false), [error, setError] = useState('')
    const [full, toggleFull] = useFullText(), [drawer, setDrawer] = useState(false), [brief, setBrief] = useState(false), [prompts, setPrompts] = useState({})
    const dirty = useRef(false), chain = useRef(Promise.resolve())
    useEffect(() => { if (!dirty.current) setMarkdown(current.script) }, [project.id, episode, current.script])
    useEffect(() => { setDrawer(false); setBrief(false) }, [episode])
    const save = next => {
      dirty.current = true; setMarkdown(next); setSaving(true); setError('')
      const task = chain.current.then(() => saveDoc(project.id, 'script', next, episode)).then(value => {
        onProject(value); dirty.current = false; setError(''); return value
      }).catch(err => { setError(err.message); throw err }).finally(() => setSaving(false))
      chain.current = task.catch(() => {})
      return task
    }
    const run = async task => { setSaving(true); setError(''); try { const next = await task(); onProject(next); dirty.current = false; setMarkdown(next.episodes.find(item => item.number === episode)?.script || ''); return next }
      catch (err) { setError(err.message); throw err } finally { setSaving(false) } }
    const generate = step => {
      if ((step === 'script' && markdown.trim() || step === 'storyboard' && current.shots.length) && !window.confirm(step === 'script' ? '重新生成剧本会覆盖本集剧本并清空镜头，继续吗？' : '重新生成分镜会覆盖本集全部镜头，继续吗？')) return
      run(() => generateDoc(project.id, step, episode)).catch(() => {})
    }
    const updateLine = (index, text) => save(replace(markdown, index, text))
    const addShot = index => save(insert(markdown, index, marker(nextId(current.shots))))
    const removeShot = shot => save(insert(remove(markdown, shot.start, 3), shot.start, '<!-- 未入镜 -->'))
    const addScene = () => save(`${markdown.trimEnd()}\n## 场 ${current.scenes.length + 1}｜${project.series?.scenes[0]?.name || '新场景'}｜${project.series?.characters[0]?.name || '人物'}\n动作：\n`)
    const mergeShot = shot => save(remove(markdown, shot.start, 3))
    const viewPrompt = async shot => {
      try { const value = await previewShot(project.id, episode, shot.id); setPrompts(items => ({ ...items, [shot.id]: value })) } catch (err) { setError(err.message) }
    }
    const focusShot = id => document.getElementById(`elysium-shot-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const entry = project.series?.episodes[episode - 1], shots = current.shots
    const done = shots.filter(item => item.status === 'succeeded').length, producing = shots.some(busy)
    let clockAt = 0
    const timings = Object.fromEntries(shots.map(shot => { const start = clockAt; clockAt += shot.duration; return [shot.id, start] }))
    const composing = ['pending', 'running'].includes(current.film_task?.status)
    // 头部只放“当前最该做的一件事”，其余操作进菜单。
    const primary = !markdown.trim() ? ['🤖 生成剧本', () => generate('script')]
      : !shots.length || current.storyboard_ready === false ? ['🤖 生成分镜', () => generate('storyboard')]
        : done < shots.length ? [producing ? `生成中 ${done}/${shots.length}` : '▶ 生产本集', () => run(() => produceEpisode(project.id, episode)).catch(() => {}), producing]
          : !current.film ? [composing ? '合成中…' : '合成本集', () => run(() => composeFilm(project.id, episode)).catch(() => {}), composing]
            : ['▶ 播放成片', () => setDrawer(true)]
    const directory = project.series?.episodes.map(item => {
      const [text, tone] = episodeProgress(project, item.number)
      return h('button', { key: item.number, type: 'button', 'aria-current': item.number === episode ? 'true' : undefined, onClick: () => selectEpisode(item.number) },
        h('b', null, `${String(item.number).padStart(2, '0')} ${item.title}`), h('small', { className: 'elysium-tone', 'data-tone': tone }, text))
    })
    const shotCard = shot => h('article', { id: `elysium-shot-${shot.id}`, className: 'elysium-shot-card', 'data-status': shot.status || 'pending' },
      h('header', null, h('b', null, shot.id), h('span', { className: 'elysium-compact-meta' }, `${clock(timings[shot.id])}–${clock(timings[shot.id] + shot.duration)}`),
        h('span', { className: 'elysium-shot-fields' },
          h(Inline, { label: `${shot.id} 景别`, value: shot.size, onCommit: text => save(replace(markdown, shot.start, markerOf(shot, { size: text }))) }),
          h(Inline, { label: `${shot.id} 运镜`, value: shot.camera, onCommit: text => save(replace(markdown, shot.start, markerOf(shot, { camera: text }))) }),
          h('span', { className: 'elysium-duration' }, h(Inline, { label: `${shot.id} 时长`, value: String(shot.duration), onCommit: text => save(replace(markdown, shot.start, markerOf(shot, { duration: Number(text) }))) }), '秒'),
          h('span', { className: 'elysium-shot-cast', title: '第一位是画面主体，首帧按其定妆图生成；留空则按剧本行自动判断' }, '人物',
            h(Inline, { label: `${shot.id} 人物`, value: shot.roles?.join('、') || '', placeholder: `${(shot.cast || []).join('、') || '空镜'}（自动）`,
              onCommit: text => save(replace(markdown, shot.start, markerOf(shot, { roles: text.replace(/[,，\s]+/g, '、') }))) }))),
        h(Badge, { status: busy(shot) ? 'running' : shot.status }),
        shot.status === 'failed' ? h('button', { type: 'button', className: 'elysium-danger', onClick: () => run(() => reshootShot(project.id, episode, shot.id)).catch(() => {}) }, '重拍') : null,
        h(Menu, { label: `${shot.id} 更多操作`, items: [
          shot.job_id && !busy(shot) ? ['重拍此镜', () => run(() => reshootShot(project.id, episode, shot.id)).catch(() => {})] : null,
          ['🤖 重写这一镜', () => run(() => generateDoc(project.id, 'storyboard', episode, shot.id)).catch(() => {})],
          ['合并到上一镜', () => mergeShot(shot)],
          ['删除镜头', () => removeShot(shot), true]] })),
      h('div', { className: 'elysium-shot-body' },
        h(Thumb, { shot }),
        h('div', { className: 'elysium-shot-text' },
          h(Inline, { label: `${shot.id} 视频`, value: shot.video, multiline: true, width: 34, className: 'elysium-shot-video', onCommit: text => save(replace(markdown, shot.start + 1, `视频：${text}`)) }),
          h('details', { className: 'elysium-keyframe', onToggle: event => { if (event.currentTarget.open && shot.video) viewPrompt(shot) } }, h('summary', null, '首帧与实际提示词'),
            h(Inline, { label: `${shot.id} 首帧`, value: shot.keyframe, multiline: true, width: 40, className: 'elysium-mono', onCommit: text => save(replace(markdown, shot.start + 2, `首帧：${text}`)) }),
            prompts[shot.id] ? h('pre', { className: 'elysium-pre', 'aria-label': `${shot.id} 实际发送的视频提示词` }, prompts[shot.id].prompt) : null))))
    return h('section', { className: 'elysium-episode' },
      h('nav', { className: 'elysium-episode-directory', 'aria-label': '分集目录' }, directory),
      h('div', { key: episode, className: 'elysium-episode-main' },
        h('header', { className: 'elysium-episode-header' },
          h('div', { className: 'elysium-page-heading' },
            h('h2', null, `第 ${episode} 集 · ${entry?.title || ''}`),
            h('span', { className: 'elysium-compact-meta' }, [clockAt && `${clockAt} 秒`, shots.length && `${shots.length} 镜`, shots.length && `画面 ${done}/${shots.length}`].filter(Boolean).join(' · ')),
            h('span', { className: 'elysium-save-state', role: 'status' }, saving ? '保存中…' : ''),
            h(FullTextToggle, { value: full, toggle: toggleFull }),
            h('button', { type: 'button', className: 'elysium-primary', disabled: saving || primary[2], onClick: primary[1] }, primary[0]),
            h(Menu, { label: '本集更多操作', items: [
              markdown.trim() ? ['🤖 重新生成剧本', () => generate('script')] : null,
              markdown.trim() && shots.length ? ['🤖 重新生成分镜', () => generate('storyboard')] : null,
              current.film ? ['重新合成本集', () => run(() => composeFilm(project.id, episode)).catch(() => {})] : null,
              ['＋ 新增一场', addScene]] })),
          entry ? h('button', { type: 'button', className: 'elysium-brief', 'aria-expanded': brief, onClick: () => setBrief(value => !value) },
            h('span', null, `梗概：${entry.summary}`), h('span', null, `钩子：${entry.hook}`)) : null),
        drawer && current.film ? h(FilmPanel, { film: current.film, shots, onClose: () => setDrawer(false), focusShot }) : null,
        error ? h('p', { className: 'elysium-banner', role: 'alert' }, error, h('button', { type: 'button', onClick: () => save(markdown).catch(() => {}) }, '重试')) : null,
        full ? h(FullText, { key: episode, label: '本集 Markdown 全文', value: current.script, onSave: next => save(next) })
          : !current.scenes.length ? h('p', { className: 'elysium-empty' }, '本集还没有剧本。点击右上角“🤖 生成剧本”。')
            : h('div', { className: 'elysium-av' },
              h('div', { className: 'elysium-av-head', 'aria-hidden': true }, h('span', null, '剧本'), h('span', null, '镜头')),
              current.scenes.map(scene => {
                const groups = []
                for (const line of scene.lines) {
                  if (groups.at(-1)?.shot_id !== line.shot_id) groups.push({ shot_id: line.shot_id, lines: [] })
                  groups.at(-1).lines.push(line)
                }
                for (const shot of shots.filter(item => item.scene_number === scene.number)) if (!groups.some(group => group.shot_id === shot.id)) groups.push({ shot_id: shot.id, lines: [] })
                return h('section', { key: scene.start, className: 'elysium-scene' },
                  h('header', { className: 'elysium-scene-head' }, h('span', { className: 'elysium-scene-number' }, `场 ${scene.number}`),
                    h(Inline, { label: `场 ${scene.number} 场景`, value: scene.name, className: 'elysium-strong', onCommit: text => save(replace(markdown, scene.start, `## 场 ${scene.number}｜${text}｜${scene.roles.join('、')}`)) }),
                    h(Inline, { label: `场 ${scene.number} 出场角色`, value: scene.roles.join('、'), onCommit: text => save(replace(markdown, scene.start, `## 场 ${scene.number}｜${scene.name}｜${text}`)) })),
                  groups.map((group, groupIndex) => {
                    const shot = shots.find(item => item.id === group.shot_id), first = group.lines[0]
                    return h('div', { key: `${scene.start}-${groupIndex}`, className: 'elysium-av-row' },
                      h('div', { className: 'elysium-script-column' }, group.lines.map((line, lineIndex) => h('div', { key: line.index, className: 'elysium-script-line', 'data-kind': kindOf(line.text) },
                        lineIndex > 0 ? h('button', { type: 'button', className: 'elysium-split', 'aria-label': `从第 ${line.index + 1} 行开始新镜头`, title: '从这里开始新镜头', onClick: () => addShot(line.index) }, '✂') : null,
                        h(Inline, { label: `第 ${line.index + 1} 行剧本`, value: line.text, multiline: true, width: 40, onCommit: text => updateLine(line.index, text),
                          onEnter: text => save(insert(replace(markdown, line.index, text), line.index + 1, '动作：')),
                          onEmptyBackspace: () => save(remove(markdown, line.index)) })))),
                      h('div', { className: 'elysium-shot-column' }, shot ? shotCard(shot)
                        : h('div', { className: 'elysium-unshot' }, '未入镜', first ? h('button', { type: 'button', className: 'elysium-link', onClick: () => addShot(first.index) }, '＋ 为这几行建镜头') : null)))
                  }))
              }))))
  }
  Object.assign(exports, { EpisodeView, episodeProgress })
  return exports
} })
