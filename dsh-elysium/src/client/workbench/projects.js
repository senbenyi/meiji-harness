// 职责：提供项目列表、项目表单，以及项目/总览/分集三页导航。
window.__ModuleLoader__.load({ id: 'elysium/projects', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { fetchProjects, fetchProject, createProject, updateProject, deleteProject, generateDoc, startFill, startProduce, pauseAuto, pollProject, downloadFilmsUrl } = require('elysium/project-api')
  const { fetchDirectors } = require('elysium/director-api')
  const { assetUrl } = require('elysium/media-api')
  const { Badge, IconButton, Menu } = require('elysium/dialog')
  const { SeriesView } = require('elysium/series')
  const { EpisodeView } = require('elysium/episode')
  const tabs = [['project', '项目'], ['series', '总览'], ['episode', '分集']]
  const filters = [['all', '全部'], ['active', '进行中'], ['paused', '已暂停'], ['todo', '未开始'], ['completed', '已完成']]
  const empty = { title: '', director: '', genre: '', synopsis: '' }
  const download = url => { const link = document.createElement('a'); link.href = url; link.download = ''; link.click() }

  function Cover({ jobId, title }) {
    const [failed, setFailed] = useState(false)
    return jobId && !failed ? h('img', { className: 'elysium-cover', src: assetUrl('image', jobId), alt: '', onError: () => setFailed(true) })
      : h('span', { className: 'elysium-cover elysium-cover-empty', 'aria-hidden': true }, title.slice(0, 1))
  }
  function Progress({ done, total }) {
    return h('span', { className: 'elysium-progress', role: 'img', 'aria-label': `${done}/${total}` }, h('i', { style: { width: `${total ? Math.round(done / total * 100) : 0}%` } }))
  }

  function ProjectFields({ draft, setDraft, directors, onBlur }) {
    const field = (label, key, rows = 1) => h('label', { className: 'elysium-field' }, h('span', null, label), rows > 1
      ? h('textarea', { 'aria-label': `项目${label}`, value: draft[key] || '', rows, onChange: event => setDraft({ ...draft, [key]: event.target.value }), onBlur })
      : h('input', { 'aria-label': `项目${label}`, value: draft[key] || '', onChange: event => setDraft({ ...draft, [key]: event.target.value }), onBlur }))
    return h('div', { className: 'elysium-form-grid' },
      field('名称', 'title'),
      h('label', { className: 'elysium-field' }, h('span', null, '导演'), h('select', { 'aria-label': '项目导演', value: draft.director, required: true,
        onChange: event => { const next = { ...draft, director: event.target.value }; setDraft(next); onBlur?.(next) } },
        directors.map(item => h('option', { key: item.name, value: item.name }, item.display_name)))),
      field('题材', 'genre'),
      h('div', { className: 'elysium-form-wide' }, field('梗概', 'synopsis', 10)))
  }

  function ProjectForm({ onSubmit, onCancel }) {
    const [draft, setDraft] = useState(empty), [directors, setDirectors] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
    useEffect(() => { fetchDirectors().then(items => { setDirectors(items); setDraft(value => value.director || !items[0] ? value : { ...value, director: items[0].name }) }).catch(err => setError(err.message)) }, [])
    const generate = async () => {
      setBusy(true); setError('')
      try { const result = await generateDoc(null, 'project', null, null, draft.director); setDraft(value => ({ ...value,
        title: result.value.title || value.title, genre: result.value.genre || value.genre, synopsis: result.value.synopsis || value.synopsis })) }
      catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    const save = async event => { event.preventDefault(); setBusy(true); setError(''); try { await onSubmit(draft) } catch (err) { setError(err.message) } finally { setBusy(false) } }
    return h('form', { className: 'elysium-project-form', onSubmit: save },
      h('header', { className: 'elysium-page-heading' }, h(IconButton, { name: 'back', label: '取消新建', onClick: onCancel }), h('h2', null, '新建项目'),
        h('button', { type: 'button', disabled: busy || !draft.director, onClick: generate }, busy ? '生成中…' : '🤖 按导演自动生成')),
      h(ProjectFields, { draft, setDraft, directors }),
      error ? h('p', { role: 'alert' }, error) : null,
      h('footer', { className: 'elysium-form-footer' }, h('button', { type: 'button', onClick: onCancel }, '取消'),
        h('button', { type: 'submit', className: 'elysium-primary', disabled: busy || !draft.title.trim() || !draft.director }, '创建项目')))
  }

  function ProjectPage({ project, onProject }) {
    const pick = value => ({ title: value.title, genre: value.genre, synopsis: value.synopsis, director: value.director })
    const [draft, setDraft] = useState(pick(project)), [directors, setDirectors] = useState([]), [status, setStatus] = useState(''), [error, setError] = useState('')
    useEffect(() => { fetchDirectors().then(setDirectors).catch(() => {}) }, [])
    useEffect(() => { if (status !== '保存中') setDraft(pick(project)) }, [project.project_text])
    const save = async (next = draft) => {
      if (Object.keys(next).every(key => next[key] === project[key])) return
      setStatus('保存中'); setError('')
      try { onProject(await updateProject(project.id, next)); setStatus('已保存') } catch (err) { setStatus(''); setError(err.message) }
    }
    return h('section', { className: 'elysium-project-page' },
      h(ProjectFields, { draft, setDraft, directors, onBlur: next => save(next?.title !== undefined ? next : draft) }),
      h('p', { className: 'elysium-save-state', role: 'status' }, status),
      error ? h('p', { role: 'alert' }, error, h('button', { type: 'button', onClick: () => save() }, '重试')) : null)
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
    if (!project) return h('div', { className: 'elysium-project-detail' }, h(IconButton, { name: 'back', label: '返回项目', onClick: back }), error ? h('p', { role: 'alert' }, error) : h('p', { role: 'status' }, '读取项目中…'))
    const count = project.series?.episodes.length || 0, films = project.episodes.filter(item => item.film).length
    const shotCount = project.episodes.reduce((sum, item) => sum + item.shots.length, 0)
    const completed = project.episodes.reduce((sum, item) => sum + item.shots.filter(shot => shot.status === 'succeeded').length, 0)
    const lead = project.series?.characters.filter(item => item.lead).map(item => item.name).join('、')
    const auto = project.auto, status = auto.paused ? 'paused' : auto.task ? 'active' : count && films === count ? 'completed' : null
    const primary = auto.task ? ['⏸ 暂停', () => run(() => pauseAuto(id))] : [auto.paused ? '继续生产' : '▶ 一键生产', () => run(() => startProduce(id))]
    return h('div', { className: 'elysium-project-detail' },
      h('header', { className: 'elysium-project-heading' },
        h(IconButton, { name: 'back', label: '返回项目', onClick: back }),
        h('div', { className: 'elysium-heading-copy' }, h('h1', null, project.title),
          h('p', { className: 'elysium-compact-meta' }, [lead && `主演 ${lead}`, `成片 ${films}/${count} 集`, `镜头 ${completed}/${shotCount}`].filter(Boolean).join(' · '))),
        status ? h(Badge, { status }) : null,
        h('button', { type: 'button', className: 'elysium-primary', disabled: busy || !count, onClick: primary[1] }, primary[0]),
        h(Menu, { label: '更多项目操作', items: [['🤖 一键补全空白内容', () => run(() => startFill(id))], films ? ['⬇ 下载全部成片', () => download(downloadFilmsUrl(id))] : null] })),
      auto.paused ? h('p', { className: 'elysium-banner', role: 'alert' }, auto.paused.reason,
        h('button', { type: 'button', onClick: () => navigate(auto.paused.episode ? 'episode' : 'series', auto.paused.episode || episode) }, '去处理')) : null,
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error) : null,
      h('nav', { className: 'elysium-page-tabs', 'aria-label': '项目页签' }, tabs.map(([page, label]) => h('button', { key: page, type: 'button',
        'aria-current': tab === page ? 'page' : undefined, onClick: () => navigate(page) }, label))),
      tab === 'project' ? h(ProjectPage, { project, onProject: setProject }) : tab === 'series'
        ? h(SeriesView, { project, onProject: setProject, selectEpisode: number => navigate('episode', number) })
        : h(EpisodeView, { project, episode, selectEpisode: number => navigate('episode', number), onProject: setProject }))
  }

  function ProjectList({ viewState = {}, onViewState = () => {} }) {
    const [items, setItems] = useState([]), [selected, setSelected] = useState(viewState.selected || null), [creating, setCreating] = useState(false)
    const [filter, setFilter] = useState('all'), [error, setError] = useState('')
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { refresh().catch(err => setError(err.message)) }, [])
    const open = id => { setSelected(id); onViewState({ selected: id }) }
    const close = () => { setSelected(null); onViewState({ selected: null }); refresh().catch(() => {}) }
    const act = action => action().then(refresh).catch(err => setError(err.message))
    const create = async draft => { const next = await createProject(draft); setCreating(false); open(next.id); await refresh() }
    const remove = item => { if (window.confirm(`删除项目“${item.title}”及其全部数据？此操作无法撤销。`)) act(() => deleteProject(item.id)) }
    if (selected) return h(ProjectDetail, { id: selected, back: close, viewState, onViewState })
    if (creating) return h(ProjectForm, { onSubmit: create, onCancel: () => setCreating(false) })
    const counts = Object.fromEntries(filters.map(([key]) => [key, items.filter(item => key === 'all' || item.status === key).length]))
    const visible = items.filter(item => filter === 'all' || item.status === filter)
    return h('section', { className: 'elysium-project-list' },
      h('header', { className: 'elysium-page-heading' },
        h('nav', { className: 'elysium-segments', 'aria-label': '项目状态筛选' }, filters.map(([key, label]) => h('button', { key, type: 'button',
          'aria-current': filter === key ? 'true' : undefined, onClick: () => setFilter(key) }, label, h('small', null, counts[key])))),
        h('button', { type: 'button', className: 'elysium-primary', onClick: () => setCreating(true) }, '＋ 新建项目')),
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error) : null,
      !visible.length ? h('p', { className: 'elysium-empty' }, items.length ? '没有符合筛选的项目' : '还没有项目，点击“新建项目”开始') : null,
      h('div', { className: 'elysium-project-grid' }, visible.map(item => h('article', { key: item.id, className: 'elysium-project-card' },
        h('button', { type: 'button', className: 'elysium-project-open', 'aria-label': `打开项目 ${item.title}`, onClick: () => open(item.id) },
          h(Cover, { jobId: item.cover_job_id, title: item.title }),
          h('span', { className: 'elysium-project-copy' },
            h('b', null, item.title),
            h('small', null, [item.genre, item.lead && `主演 ${item.lead}`].filter(Boolean).join(' · ') || '未定题材'),
            h(Progress, { done: item.film_count, total: item.episode_count }),
            h('small', null, item.episode_count ? `成片 ${item.film_count}/${item.episode_count} 集 · 镜头 ${item.completed_count}/${item.shot_count}` : '尚未生成总览'),
            item.paused ? h('small', { className: 'elysium-error-text' }, item.paused.reason) : null)),
        h('div', { className: 'elysium-project-card-side' }, h(Badge, { status: item.status }),
          h(Menu, { label: `${item.title} 更多操作`, items: [
            ['🤖 一键补全空白内容', () => act(() => startFill(item.id))],
            item.running ? ['⏸ 暂停生产', () => act(() => pauseAuto(item.id))] : [item.paused ? '继续生产' : '▶ 一键生产', () => act(() => startProduce(item.id))],
            item.film_count ? ['⬇ 下载全部成片', () => download(downloadFilmsUrl(item.id))] : null,
            ['删除项目', () => remove(item), true]] }))))))
  }
  Object.assign(exports, { ProjectList, ProjectDetail })
  return exports
} })
