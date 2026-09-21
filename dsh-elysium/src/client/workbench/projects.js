// 职责：提供项目列表、项目表单，以及项目/总览/分集三页导航。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { fetchProjects, fetchProject, createProject, updateProject, deleteProject, generateDoc, startFill, startProduce, pauseAuto, pollProject, downloadFilmsUrl } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { SeriesView } = require('elysium/series')
  const { EpisodeView } = require('elysium/episode')
  const { ShotPreview } = require('elysium/shot-preview')
  const tabs = [['project', '项目'], ['series', '总览'], ['episode', '分集']]
  const empty = { title: '', director: '', genre: '', synopsis: '' }

  function ProjectForm({ initial = empty, onSubmit, onCancel, title = '新建项目' }) {
    const [draft, setDraft] = useState(initial), [directors, setDirectors] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { fetchDirectors().then(items => { setDirectors(items); if (!draft.director && items[0]) setDraft(value => ({ ...value, director: items[0].name })) }).catch(err => setError(err.message)) }, [])
    const generate = async () => {
      if (!draft.director) return
      setBusy(true); setError('')
      try { const result = await generateDoc(null, 'project', null, null, draft.director); setDraft(value => ({ ...value,
        title: result.value.title || value.title, genre: result.value.genre || value.genre, synopsis: result.value.synopsis || value.synopsis })) }
      catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    const save = async event => { event.preventDefault(); setBusy(true); setError(''); try { await onSubmit(draft) }
      catch (err) { setError(err.message) } finally { setBusy(false) } }
    return h('form', { className: 'elysium-project-form', onSubmit: save },
      h('h2', null, title),
      h('label', { className: 'elysium-field' }, '导演', h('select', { 'aria-label': '项目导演', value: draft.director, required: true, onChange: event => setDraft({ ...draft, director: event.target.value }) },
        directors.map(item => h('option', { key: item.name, value: item.name }, item.display_name)))),
      h('button', { type: 'button', disabled: busy || !draft.director, onClick: generate }, '🤖 自动生成梗概'),
      h('label', { className: 'elysium-field' }, '名称', h('input', { 'aria-label': '项目名称', value: draft.title, required: true, onChange: event => setDraft({ ...draft, title: event.target.value }) })),
      h('label', { className: 'elysium-field' }, '题材', h('input', { 'aria-label': '项目题材', value: draft.genre, onChange: event => setDraft({ ...draft, genre: event.target.value }) })),
      h('label', { className: 'elysium-field' }, '梗概', h('textarea', { 'aria-label': '项目梗概', value: draft.synopsis, rows: 8, onChange: event => setDraft({ ...draft, synopsis: event.target.value }) })),
      error ? h('p', { role: 'alert' }, error) : null,
      h('footer', { className: 'elysium-card-actions' }, h('button', { type: 'button', onClick: onCancel }, '取消'),
        h('button', { type: 'submit', className: 'elysium-primary', disabled: busy || !draft.title.trim() || !draft.director }, busy ? '保存中' : '保存')))
  }

  function ProjectPage({ project, onProject }) {
    const [draft, setDraft] = useState({ title: project.title, genre: project.genre, synopsis: project.synopsis, director: project.director })
    const [directors, setDirectors] = useState([]), [status, setStatus] = useState('已保存'), [error, setError] = useState('')
    useEffect(() => { fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    useEffect(() => { if (status === '已保存') setDraft({ title: project.title, genre: project.genre, synopsis: project.synopsis, director: project.director }) }, [project.project_text])
    const save = async () => {
      if (Object.keys(draft).every(key => draft[key] === project[key])) return
      setStatus('保存中'); setError('')
      try { onProject(await updateProject(project.id, draft)); setStatus('已保存') }
      catch (err) { setStatus('保存失败'); setError(err.message) }
    }
    const field = (label, key, rows = 1) => h('label', { className: 'elysium-field' }, label, rows > 1
      ? h('textarea', { 'aria-label': label, value: draft[key], rows, onChange: event => setDraft({ ...draft, [key]: event.target.value }), onBlur: save })
      : h('input', { 'aria-label': label, value: draft[key], onChange: event => setDraft({ ...draft, [key]: event.target.value }), onBlur: save }))
    return h('section', { className: 'elysium-project-page' }, h('h2', null, '项目信息'),
      h('label', { className: 'elysium-field' }, '导演', h('select', { 'aria-label': '项目导演', value: draft.director,
        onChange: event => { const next = { ...draft, director: event.target.value }; setDraft(next); updateProject(project.id, next).then(onProject).catch(err => setError(err.message)) } },
        directors.map(item => h('option', { key: item.name, value: item.name }, item.display_name)))),
      field('名称', 'title'), field('题材', 'genre'), field('梗概', 'synopsis', 8),
      h('span', { role: 'status' }, status), error ? h('p', { role: 'alert' }, error, h('button', { type: 'button', onClick: save }, '重试')) : null)
  }

  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {} }) {
    const saved = viewState.projects?.[id] || {}, [project, setProject] = useState(null)
    const [tab, setTab] = useState(saved.tab || null), [episode, setEpisode] = useState(saved.episode || 1)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setProject(await fetchProject(id))
    useEffect(() => { refresh().catch(err => setError(err.message)) }, [id])
    useEffect(() => {
      if (!project) return
      let active = true, timer
      const poll = async () => {
        try { if ((await pollProject(id, Math.floor(project.updated_at))).updated && active) await refresh() }
        catch (err) { if (active) setError(err.message) }
        finally { if (active) timer = setTimeout(poll, 4000) }
      }
      timer = setTimeout(poll, 4000)
      return () => { active = false; clearTimeout(timer) }
    }, [id, project?.updated_at])
    useEffect(() => { if (project && !tab) setTab(project.series ? 'episode' : 'series') }, [project?.series_text])
    const navigate = (page, selected = episode) => {
      setTab(page); setEpisode(selected)
      onViewState({ projects: { ...viewState.projects, [id]: { ...saved, tab: page, episode: selected } }, projectTab: page })
    }
    const run = async action => { setBusy(true); setError(''); try { setProject(await action()) } catch (err) { setError(err.message) } finally { setBusy(false) } }
    if (!project) return h('div', null, h('button', { onClick: back }, '返回项目'), error ? h('p', { role: 'alert' }, error) : '读取项目中…')
    const count = project.series?.episodes.length || 0, films = project.episodes.filter(item => item.film).length
    const shotCount = project.episodes.reduce((sum, item) => sum + item.shots.length, 0)
    const completed = project.episodes.reduce((sum, item) => sum + item.shots.filter(shot => shot.status === 'succeeded').length, 0)
    return h('div', { className: 'elysium-project-detail' },
      h('header', { className: 'elysium-project-heading' }, h('button', { type: 'button', onClick: back }, '← 返回项目'), h('h1', null, project.title),
        h('span', null, `主演 ${project.series?.characters.filter(item => item.lead).map(item => item.name).join('、') || '—'} · 成片 ${films}/${count} 集 · 镜头 ${completed}/${shotCount}`)),
      h('nav', { className: 'elysium-project-steps', 'aria-label': '项目页签' }, tabs.map(([page, label]) => h('button', { key: page, type: 'button',
        'aria-current': tab === page ? 'page' : undefined, onClick: () => navigate(page) }, label))),
      h('div', { className: 'elysium-card-actions' },
        h('button', { type: 'button', disabled: busy, onClick: () => run(() => startFill(id)) }, '🤖 一键补全'),
        h('button', { type: 'button', disabled: busy, onClick: () => run(() => startProduce(id)) }, project.auto.paused ? '继续生产' : '▶ 一键生产'),
        project.auto.task ? h('button', { type: 'button', disabled: busy, onClick: () => run(() => pauseAuto(id)) }, '⏸ 暂停') : null,
        project.auto.paused ? h('span', { role: 'alert' }, project.auto.paused.reason) : null),
      error ? h('p', { role: 'alert' }, error) : null,
      tab === 'project' ? h(ProjectPage, { project, onProject: setProject }) : tab === 'series'
        ? h(SeriesView, { project, onProject: setProject, selectEpisode: number => navigate('episode', number) })
          : h(EpisodeView, { project, episode, selectEpisode: number => navigate('episode', number), onProject: setProject }))
  }

  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() }) {
    const [items, setItems] = useState([]), [selected, setSelected] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [filter, setFilter] = useState('all'), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { refresh().catch(err => setError(err.message)) }, [])
    const open = id => { setSelected(id); onViewState({ selected: id }) }
    const close = () => { setSelected(null); onViewState({ selected: null }); refresh().catch(() => {}) }
    const create = async draft => {
      setBusy(true)
      try { const next = await createProject(draft); setCreating(false); open(next.id); await refresh() }
      finally { setBusy(false) }
    }
    const remove = async id => {
      if (!window.confirm('删除这个项目及其数据？')) return
      setBusy(true); setError('')
      try { await deleteProject(id); await refresh() }
      catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { id: selected, back: close, viewState, onViewState })
    if (creating) return h(ProjectForm, { onSubmit: create, onCancel: () => setCreating(false) })
    return h('section', { className: 'elysium-project-list' },
      h('header', { className: 'elysium-card-actions' }, h('h2', null, '项目'), h('button', { type: 'button', className: 'elysium-primary', onClick: () => setCreating(true) }, '＋ 新建'),
        h('select', { 'aria-label': '项目状态筛选', value: filter, onChange: event => setFilter(event.target.value) },
          [['all', '全部'], ['todo', '未开始'], ['active', '进行中'], ['paused', '已暂停'], ['completed', '已完成']].map(([key, label]) => h('option', { key, value: key }, label)))),
      error ? h('p', { role: 'alert' }, error) : null,
      items.filter(item => filter === 'all' || item.status === filter).map(item => h('article', { key: item.id, className: 'elysium-project-card' },
        item.cover_job_id ? h(ShotPreview, { jobId: item.cover_job_id, imageOnly: true }) : null,
        h('button', { type: 'button', onClick: () => open(item.id) }, h('b', null, item.title), ` · ${item.genre || '未定题材'} · ${item.lead || '未定主演'}`),
        h('p', null, `成片 ${item.film_count}/${item.episode_count} 集 · 镜头 ${item.completed_count}/${item.shot_count} · ${item.status}`),
        item.paused ? h('p', { role: 'alert' }, item.paused.reason) : null,
        h('div', { className: 'elysium-card-actions' },
          h('button', { type: 'button', onClick: () => startFill(item.id).then(refresh).catch(err => setError(err.message)) }, '🤖 一键补全'),
          h('button', { type: 'button', onClick: () => startProduce(item.id).then(refresh).catch(err => setError(err.message)) }, item.paused ? '继续生产' : '▶ 一键生产'),
          item.status === 'active' ? h('button', { type: 'button', onClick: () => pauseAuto(item.id).then(refresh).catch(err => setError(err.message)) }, '⏸ 暂停') : null,
          item.film_count ? h('a', { href: downloadFilmsUrl(item.id), download: true }, '⬇ 下载全部成片') : null,
          h('button', { type: 'button', disabled: busy, onClick: () => remove(item.id) }, '删除')))))
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
