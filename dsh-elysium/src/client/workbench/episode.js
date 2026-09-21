// 职责：在一屏内编辑本集剧本与镜头、查看任务和成片。
window.__ModuleLoader__.load({ id: 'elysium/episode', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const { saveDoc, generateDoc, reshootShot, previewShot, composeFilm, produceEpisode } = require('elysium/project-api')
  const { assetUrl } = require('elysium/media-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const replace = (markdown, index, text) => { const lines = markdown.split('\n'); lines[index] = text; return lines.join('\n') }
  const remove = (markdown, index, count = 1) => { const lines = markdown.split('\n'); lines.splice(index, count); return lines.join('\n') }
  const insert = (markdown, index, text) => { const lines = markdown.split('\n'); lines.splice(index, 0, text); return lines.join('\n') }
  const marker = (id, size = '中景', camera = '固定', duration = 5) => `### [${id}] ${size}｜${camera}｜${duration} 秒\n视频：\n首帧：`
  const nextId = shots => `S${String(Math.max(0, ...shots.map(item => Number(item.id.slice(1)))) + 1).padStart(2, '0')}`

  function Inline({ label, value, onCommit, rows = 1, onEnter, onEmptyBackspace }) {
    const [draft, setDraft] = useState(value || ''), [error, setError] = useState('')
    useEffect(() => { if (document.activeElement?.getAttribute('aria-label') !== label) setDraft(value || '') }, [value])
    const commit = async () => {
      if (draft === value) return
      try { await onCommit(draft); setError('') } catch (err) { setError(err.message) }
    }
    const props = { 'aria-label': label, value: draft, onChange: event => setDraft(event.target.value), onBlur: commit,
      onKeyDown: event => {
        if (event.key === 'Enter' && onEnter && !event.shiftKey) { event.preventDefault(); onEnter(draft) }
        if (event.key === 'Backspace' && !draft && onEmptyBackspace) { event.preventDefault(); onEmptyBackspace() }
      } }
    return h('span', { className: `elysium-inline${error ? ' elysium-inline-error' : ''}` },
      rows > 1 ? h('textarea', { ...props, rows }) : h('input', props), error ? h('small', { role: 'alert' }, error) : null)
  }

  function FilmDrawer({ film, shots, onClose, focusShot }) {
    const video = useRef(null), [time, setTime] = useState(0)
    let cursor = 0
    const entries = shots.map(shot => { const start = cursor; cursor += shot.duration; return { shot, start, end: cursor } })
    return h('aside', { className: 'elysium-film-drawer', 'aria-label': '本集成片' },
      h('header', null, h('h3', null, '本集成片'), h('button', { type: 'button', onClick: onClose }, '关闭')),
      h('video', { ref: video, controls: true, src: assetUrl('video', film.job_id), onTimeUpdate: event => setTime(event.currentTarget.currentTime) }),
      h('p', null, h('a', { href: assetUrl('video', film.job_id), download: true }, '下载视频'), film.subtitle_job_id
        ? h('a', { href: assetUrl('download', film.subtitle_job_id), download: true }, '下载字幕') : null),
      h('ol', null, entries.map(({ shot, start, end }) => h('li', { key: shot.id, 'data-current': time >= start && time < end || undefined },
        h('button', { type: 'button', onClick: () => { video.current.currentTime = start; focusShot(shot.id) } },
          `${shot.id} · ${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}–${Math.floor(end / 60)}:${String(end % 60).padStart(2, '0')}`)))))
  }

  function EpisodeView({ project, episode, selectEpisode, onProject }) {
    const current = project.episodes.find(item => item.number === episode) || { script: '', scenes: [], shots: [], film: null }
    const [markdown, setMarkdown] = useState(current.script), [saving, setSaving] = useState(false), [error, setError] = useState('')
    const [full, setFull] = useState(false), [drawer, setDrawer] = useState(false), [expanded, setExpanded] = useState({}), [preview, setPreview] = useState({})
    const dirty = useRef(false), chain = useRef(Promise.resolve())
    useEffect(() => { if (!dirty.current) setMarkdown(current.script) }, [project.id, episode, current.script])
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
      if ((step === 'script' && markdown.trim() || step === 'storyboard' && current.shots.length) && !window.confirm('重新生成会覆盖当前内容，继续吗？')) return
      run(() => generateDoc(project.id, step, episode)).catch(() => {})
    }
    const updateLine = (index, text) => save(replace(markdown, index, text))
    const addShot = index => save(insert(markdown, index, marker(nextId(current.shots))))
    const removeShot = shot => save(remove(markdown, shot.start, 3))
    const mergeShot = shot => save(remove(markdown, shot.start, 3))
    const insertEmpty = shot => {
      const sameScene = current.scenes.find(item => item.number === shot.scene_number)
      const later = current.shots.filter(item => item.scene_number === shot.scene_number && item.start > shot.start).sort((a, b) => a.start - b.start)[0]
      const nextScene = current.scenes.find(item => item.number > shot.scene_number)
      const at = later?.start ?? nextScene?.start ?? markdown.split('\n').length - 1
      return save(insert(markdown, at, marker(nextId(current.shots))))
    }
    const viewPrompt = async shot => {
      try { const result = await previewShot(project.id, episode, shot.id); setPreview(value => ({ ...value, [shot.id]: result })) }
      catch (err) { setError(err.message) }
    }
    const focusShot = id => document.getElementById(`elysium-shot-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const entry = project.series?.episodes[episode - 1], done = current.shots.filter(item => item.status === 'succeeded').length
    let clock = 0
    const timings = Object.fromEntries(current.shots.map(shot => { const start = clock; clock += shot.duration; return [shot.id, start] }))
    return h('section', { className: 'elysium-episode' },
      h('aside', { className: 'elysium-episode-directory', 'aria-label': '分集目录' }, project.series?.episodes.map(item => {
        const data = project.episodes.find(part => part.number === item.number), shots = data?.shots || [], completed = shots.filter(shot => shot.status === 'succeeded').length
        const progress = data?.film ? '✓ 成片' : shots.length ? `画面 ${completed}/${shots.length}` : data?.script ? '剧本 ✓' : '剧本 —'
        return h('button', { key: item.number, type: 'button', 'aria-current': item.number === episode ? 'true' : undefined,
          onClick: () => selectEpisode(item.number) }, `${String(item.number).padStart(2, '0')} ${item.title} · ${progress}`)
      })),
      h('div', { className: 'elysium-episode-main' },
        h('header', { className: 'elysium-episode-header' }, h('h2', null, `第 ${episode} 集 · ${entry?.title || ''}`),
          h('p', null, `${clock} 秒 · ${current.shots.length} 镜 · 画面 ${done}/${current.shots.length} · 成片 ${current.film ? '✓' : '—'}`),
          h('details', null, h('summary', null, '梗概与钩子'), h('p', null, entry?.summary), h('p', null, entry?.hook)),
          h('div', { className: 'elysium-card-actions' },
            h('button', { type: 'button', disabled: saving, onClick: () => generate('script') }, '🤖 生成剧本'),
            h('button', { type: 'button', disabled: saving || !markdown.trim(), onClick: () => generate('storyboard') }, '🤖 生成分镜'),
            h('button', { type: 'button', disabled: saving || !current.shots.length, onClick: () => run(() => produceEpisode(project.id, episode)).catch(() => {}) }, '▶ 生产本集'),
            current.film ? h('button', { type: 'button', onClick: () => setDrawer(true) }, '▶ 播放成片') : null,
            h('button', { type: 'button', onClick: () => setFull(value => !value) }, full ? '返回双栏' : '全文编辑'),
            h('span', { role: 'status' }, saving ? '保存中' : error ? '保存失败' : '已保存'))),
        error ? h('p', { role: 'alert' }, error, h('button', { type: 'button', onClick: () => save(markdown).catch(() => {}) }, '重试')) : null,
        full ? h('textarea', { className: 'elysium-full-script', 'aria-label': '本集 Markdown 全文', value: markdown, rows: 25,
          onChange: event => { dirty.current = true; setMarkdown(event.target.value) }, onBlur: () => save(markdown).catch(() => {}) })
          : current.scenes.map(scene => {
            const groups = []
            for (const line of scene.lines) {
              const last = groups.at(-1)
              if (last?.shot_id !== line.shot_id) groups.push({ shot_id: line.shot_id, lines: [] })
              groups.at(-1).lines.push(line)
            }
            const sceneShots = current.shots.filter(shot => shot.scene_number === scene.number)
            for (const shot of sceneShots) if (!groups.some(group => group.shot_id === shot.id)) groups.push({ shot_id: shot.id, lines: [] })
            return h('section', { key: scene.start, className: 'elysium-scene' },
              h('h3', null, `场 ${scene.number}｜${scene.name}｜${scene.roles.join('、')}`),
              groups.map((group, groupIndex) => {
                const shot = current.shots.find(item => item.id === group.shot_id)
                const first = group.lines[0]
                return h('div', { key: `${scene.start}-${groupIndex}`, className: 'elysium-av-row' },
                  h('div', { className: 'elysium-script-column' }, group.lines.map((line, lineIndex) => h('div', { key: line.index, className: 'elysium-script-line' },
                    lineIndex > 0 ? h('button', { type: 'button', className: 'elysium-split', onClick: () => addShot(line.index) }, '✂ 从这里开始新镜头') : null,
                    h(Inline, { label: `第 ${line.index + 1} 行剧本`, value: line.text, onCommit: text => updateLine(line.index, text),
                      onEnter: text => save(insert(replace(markdown, line.index, text), line.index + 1, '动作：')),
                      onEmptyBackspace: () => save(remove(markdown, line.index)) })))),
                  h('div', { className: 'elysium-shot-column' }, shot ? h('article', { id: `elysium-shot-${shot.id}`, className: 'elysium-shot-card' },
                    h('header', null, h('b', null, shot.id), ` ${timings[shot.id]}–${timings[shot.id] + shot.duration} 秒 · ${shot.status || '待生成'}`),
                    shot.job_id ? h(ShotPreview, { jobId: shot.job_id }) : null,
                    h('div', { className: 'elysium-shot-fields' },
                      h(Inline, { label: `${shot.id} 景别`, value: shot.size, onCommit: text => save(replace(markdown, shot.start, `### [${shot.id}] ${text}｜${shot.camera}｜${shot.duration} 秒`)) }),
                      h(Inline, { label: `${shot.id} 运镜`, value: shot.camera, onCommit: text => save(replace(markdown, shot.start, `### [${shot.id}] ${shot.size}｜${text}｜${shot.duration} 秒`)) }),
                      h(Inline, { label: `${shot.id} 时长`, value: String(shot.duration), onCommit: text => save(replace(markdown, shot.start, `### [${shot.id}] ${shot.size}｜${shot.camera}｜${Number(text)} 秒`)) })),
                    h('button', { type: 'button', onClick: () => setExpanded(value => ({ ...value, [shot.id]: !value[shot.id] })) }, expanded[shot.id] ? '收起描述' : '展开描述'),
                    expanded[shot.id] ? h('div', null,
                      h(Inline, { label: `${shot.id} 视频`, value: shot.video, rows: 3, onCommit: text => save(replace(markdown, shot.start + 1, `视频：${text}`)) }),
                      h(Inline, { label: `${shot.id} 首帧`, value: shot.keyframe, rows: 2, onCommit: text => save(replace(markdown, shot.start + 2, `首帧：${text}`)) })) : null,
                    h('div', { className: 'elysium-card-actions' },
                      shot.job_id ? h('button', { type: 'button', onClick: () => run(() => reshootShot(project.id, episode, shot.id)).catch(() => {}) }, '重拍') : null,
                      h('button', { type: 'button', onClick: () => viewPrompt(shot) }, '查看实际提示词'),
                      h('button', { type: 'button', onClick: () => run(() => generateDoc(project.id, 'storyboard', episode, shot.id)).catch(() => {}) }, '🤖 重写这一镜'),
                      h('button', { type: 'button', onClick: () => mergeShot(shot) }, '合并到上一镜'),
                      h('button', { type: 'button', onClick: () => insertEmpty(shot) }, '在后面插入空镜'),
                      h('button', { type: 'button', onClick: () => removeShot(shot) }, '删除镜头')),
                    preview[shot.id] ? h('pre', null, `视频：${preview[shot.id].prompt}\n首帧：${preview[shot.id].keyframe_prompt}`) : null)
                    : h('div', { className: 'elysium-unshot' }, '未入镜', first ? h('button', { type: 'button', onClick: () => addShot(first.index) }, '+ 为这几行建镜头') : null)))
              }))
          })),
      drawer && current.film ? h(FilmDrawer, { film: current.film, shots: current.shots, onClose: () => setDrawer(false), focusShot }) : null)
  }
  Object.assign(exports, { EpisodeView })
  return exports
} })
