window.__ModuleLoader__.load('elysium-tools/project', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { projectUrl } = require('elysium-tools/media-api')
  const { assetUrl, relativeTime, MaterialList } = require('elysium-tools/asset-list')
  const { Dialog, Editor } = require('elysium-tools/dialog')
  const profiles = { preview: '预览', regular: '常规', 'high-quality': '高清' }
  async function request(action, body, params = {}) {
    const response = await fetch(projectUrl(action, params), { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '项目操作失败')
    return value
  }
  const fetchProjects = () => request('list')
  const fetchProject = id => request('get', null, { id })
  const createProject = (title, profile) => request('create', { title, profile })
  const updateProject = (id, patch) => request('update', { ...patch, id })
  const deleteProject = id => request('delete', { id })
  const importMaterial = (id, jobId, as = 'anchor', role) => request('import', { id, job_id: jobId, as, ...(role ? { role } : {}) })
  const previews = new Map()
  function ShotPreview({ jobId }) {
    const [job, setJob] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
    useEffect(() => {
      let active = true
      setJob(null); setError('')
      if (!jobId) return
      const key = assetUrl('status', jobId)
      if (retry) previews.delete(key)
      if (!previews.has(key)) {
        const entry = { controller: new AbortController(), users: 0, settled: false }
        entry.promise = fetch(key, { cache: 'no-store', credentials: 'same-origin', signal: entry.controller.signal }).then(async response => {
          const value = await response.json(); if (!response.ok) throw new Error(value.error || '预览读取失败'); entry.settled = true; return value
        }).catch(error => { if (previews.get(key) === entry) previews.delete(key); throw error })
        previews.set(key, entry)
        if (previews.size > 30) previews.delete(previews.keys().next().value)
      }
      const entry = previews.get(key)
      entry.users++
      entry.promise.then(value => { if (active) setJob(value); if (value.status && value.status !== 'succeeded' && previews.get(key) === entry) previews.delete(key) }).catch(err => { if (active && err.name !== 'AbortError') setError(err.message) })
      return () => { active = false; entry.users--; if (!entry.users && !entry.settled) { entry.controller.abort(); if (previews.get(key) === entry) previews.delete(key) } }
    }, [jobId, retry])
    if (!jobId) return h('p', { className: 'elysium-empty' }, '尚未关联素材')
    if (error) return h('div', { role: 'alert' }, error, h('button', { onClick: () => setRetry(value => value + 1) }, '重试预览'))
    if (!job) return h('p', { role: 'status' }, '正在加载预览…')
    return job.has_video ? h('video', { className: 'elysium-workbench-preview', src: assetUrl('video', jobId), preload: 'metadata', controls: true, onError: () => setError('预览加载失败') }) : job.has_image ? h('img', { className: 'elysium-workbench-preview', src: assetUrl('image', jobId), alt: '镜头图片', onError: () => setError('图片加载失败') }) : h('div', null, h('p', null, '暂无可播放产物'), h('button', { onClick: () => setRetry(value => value + 1) }, '刷新状态'))
  }
  function ProjectPicker({ jobId, close }) {
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [loading, setLoading] = useState(true)
    useEffect(() => { let active = true; fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
    async function choose() {
      if (busy || !selected) return
      setBusy(true); setError('')
      try { await importMaterial(selected, jobId); close() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    return h(Dialog, { title: '选择项目', close, busy, footer: h('button', { className: 'elysium-primary', disabled: busy || !selected, onClick: choose }, busy ? '正在使用…' : '用作项目锚点') },
      h('p', null, '选择目标项目，确认后新增一个锚点'),
      items.map(item => h('button', { key: item.id, disabled: busy, 'aria-pressed': selected === item.id, onClick: () => setSelected(item.id) }, item.title)),
      loading ? h('p', { role: 'status' }, '正在读取项目…') : !items.length ? h('p', null, '请先在项目页新建项目') : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  function AnchorView({ project, save, run, busy, guard }) {
    const [selecting, setSelecting] = useState(null), [editing, setEditing] = useState(null), [inspecting, setInspecting] = useState(null)
    return h('div', { className: 'elysium-anchor-view' },
      h('div', { className: 'elysium-toolbar' }, h('h2', null, '锚点'), h('button', { className: 'elysium-primary', disabled: busy, onClick: () => {
        let number = project.anchors.length + 1
        while (project.anchors.some(anchor => anchor.role === `role-${number}`)) number++
        setEditing({ index: -1, role: `role-${number}`, label: '新锚点', description: '', image_url: '', source: null })
      } }, '添加锚点')),
      h('div', { className: 'elysium-material-grid' }, project.anchors.map((anchor, index) => h('article', { key: anchor.role, className: 'elysium-material-card' },
        anchor.image_url ? h('img', { src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : h('div', { className: 'elysium-video-placeholder' }, anchor.source?.job_id ? '视频参考素材' : '暂无参考图'),
        h('button', { onClick: () => setInspecting(anchor) }, '查看参考素材'), h('h3', null, anchor.label || anchor.role), h('p', { className: 'elysium-two-lines' }, anchor.description || '未填写描述'),
        h('button', { disabled: busy, onClick: () => setEditing({ ...anchor, index }) }, '编辑锚点'),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor) }, '选择参考素材')))),
      inspecting ? h(Dialog, { title: inspecting.label || inspecting.role, close: () => setInspecting(null) }, inspecting.image_url ? h('img', { className: 'elysium-workbench-preview', src: inspecting.image_url, alt: inspecting.label }) : h(ShotPreview, { jobId: inspecting.source?.job_id }), h('p', null, inspecting.description)) : null,
      selecting ? h(Dialog, { title: `为「${selecting.label || selecting.role}」选择参考素材`, close: () => setSelecting(null), busy },
        h(MaterialList, { viewState: { media_kind: 'image' }, onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting.role); setSelecting(null); return value }) })) : null,
      editing ? h(Editor, { title: '编辑锚点', initial: editing, guard, fields: [['label', '锚点名称'], ['description', '锚点描述', 'textarea'], ['role', '锚点角色 ID', null, true], ['image_url', '参考图服务器 URL', null, true]], close: () => setEditing(null), save: draft => {
        const { index, ...anchor } = draft
        if (anchor.image_url !== editing.image_url) anchor.source = null
        return save({ anchors: index === -1 ? [...project.anchors, anchor] : project.anchors.map((item, i) => i === index ? anchor : item),
          ...(index >= 0 && editing.role !== anchor.role ? { acts: project.acts.map(act => ({ ...act, shots: act.shots.map(shot => shot.role === editing.role ? { ...shot, role: anchor.role } : shot) })) } : {}) })
      } }) : null)
  }
  const { StoryboardView } = require('elysium-tools/storyboard-view')
  function deliveryUrl(item) {
    if (item.job_id) return assetUrl('download', item.job_id)
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch { /* Older project metadata may lack a server URL. */ }
    return null
  }
  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '大小未记录'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(2))}KB`
    return `${Number((bytes / 1024 / 1024).toFixed(2))}MB`
  }
  function DeliveryView({ project }) {
    const isSubtitle = item => ['subtitle', 'srt', 'vtt'].includes(item.type)
    const [selected, setSelected] = useState(null), [error, setError] = useState(false)
    const item = project.deliverables[selected], url = item && deliveryUrl(item)
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        !project.deliverables.length ? h('p', { className: 'elysium-empty' }, `尚无交付物 · ${project.acts.flatMap(act => act.shots).filter(shot => shot.status === 'succeeded').length} 镜已完成`) : !item ? h('p', { className: 'elysium-empty' }, '选择成片，开始审看') : null,
        item ? h('div', null, h('h2', null, item.label), error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => setError(false) }, '重试预览')) : url ? h('video', { key: url, className: 'elysium-workbench-preview', src: item.job_id ? assetUrl('video', item.job_id) : url, controls: true, preload: 'metadata', onError: () => setError(true) }) : h('p', { role: 'alert' }, '缺少可播放的服务器地址')) : null),
      h('section', null, h('h2', null, '交付文件'), project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(formatSize(item.size_bytes))
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${isSubtitle(item) ? '字幕' : '成片'} · ${item.label}`), h('p', null, specs.join(' · ') || '规格未提供'),
          item.created_at ? h('small', null, relativeTime(item.created_at)) : null,
          !isSubtitle(item) && url ? h('button', { onClick: () => { setSelected(index); setError(false) } }, '审看成片') : null,
          url ? h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer' }, '下载') : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      })))
  }
  function ProjectDetail({ id, back, viewState = {}, onViewState = () => {}, guard, navigate = action => action() }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState(viewState.projects?.[id]?.tab || viewState.projectTab || null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id, reload])
    async function run(action) {
      if (saving.current) return false
      saving.current = true; setBusy(true); setError(''); setSaved(false)
      try { setProject(await action()); setSaved(true); return true } catch (err) { setError(err.message); return false } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    const activeTab = tab || (project?.acts.some(act => act.shots.length) ? 'acts' : 'anchors')
    return h('div', { className: 'elysium-project-detail' },
      h('div', { className: 'elysium-project-heading' }, h('button', { disabled: busy, onClick: () => navigate(back) }, '返回项目'),
        h('h1', null, project?.title || '项目'), project ? h('button', { disabled: busy, onClick: () => setEditing(true) }, '修改标题') : null,
        h('span', { role: 'status' }, busy ? '保存中…' : saved ? '已保存' : '')),
      error ? h('p', { role: 'alert' }, error, !project ? h('button', { onClick: () => { setError(''); setReload(x => x + 1) } }, '重试') : null) : null,
      project ? h('div', { className: 'elysium-project-content' },
        h('div', { role: 'tablist', 'aria-label': '项目页面' }, [['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '交付']].map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': activeTab === value, disabled: busy, onClick: () => navigate(() => { setTab(value); onViewState({ projectTab: value, projects: { ...viewState.projects, [id]: { ...viewState.projects?.[id], tab: value } } }) }) }, label))),
        activeTab === 'anchors' ? h(AnchorView, { project, save, run, busy, guard }) : activeTab === 'acts' ? h(StoryboardView, { project, save, busy, guard, viewState: viewState.projects?.[id], onViewState: value => onViewState({ projects: { ...viewState.projects, [id]: value } }) }) : h(DeliveryView, { project })) : h('p', { role: 'status' }, '加载中…'),
      editing ? h(Editor, { title: '修改项目标题', initial: { title: project.title }, fields: [['title', '项目标题']], guard, close: () => setEditing(false), save }) : null)
  }
  function ProjectList({ viewState = {}, onViewState = () => {}, guard, navigate = action => action() } = {}) {
    const [items, setItems] = useState([]), [selected, setSelectedLocal] = useState(viewState.selected || null), [creating, setCreating] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
    const setSelected = selected => { setSelectedLocal(selected); onViewState({ selected, ...(selected !== viewState.selected ? { projectTab: null } : {}) }) }
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { let active = true; if (!selected) { setBusy(true); fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) }) } return () => { active = false } }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action(); return true } catch (err) { setError(err.message); return false } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, viewState, onViewState, guard, navigate, back: () => setSelected(null) })
    return h('div', { className: 'elysium-project-home' },
      h('div', { className: 'elysium-toolbar' }, h('h1', null, '项目'), h('input', { type: 'search', 'aria-label': '搜索项目', placeholder: '搜索项目', value: query, onChange: e => setQuery(e.target.value) }), h('button', { className: 'elysium-primary', onClick: () => setCreating(true) }, '新建项目')),
      busy ? h('p', { role: 'status' }, '正在读取项目…') : null,
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => run(refresh) }, '重试')) : null,
      !busy && !items.length && !error ? h('p', { className: 'elysium-empty' }, '还没有项目，从新建项目开始') : null,
      h('div', { className: 'elysium-project-grid' }, items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item => h('article', { className: 'elysium-material-card', key: item.id },
        item.cover_url ? h('img', { src: item.cover_url, loading: 'lazy', alt: item.title }) : h('div', { className: 'elysium-video-placeholder' }, item.title.slice(0, 1)),
        h('h2', null, item.title), h('p', null, `${profiles[item.profile === 'hd' ? 'high-quality' : item.profile] || item.profile} · ${item.anchor_count} 锚点`),
        h('p', null, `${item.completed_count}/${item.shot_count} 镜完成 · ${relativeTime(item.updated_at)}`),
        h('button', { className: 'elysium-primary', onClick: () => setSelected(item.id), disabled: busy, 'aria-label': `继续制作 ${item.title}` }, '继续制作'),
        h('details', null, h('summary', null, '更多操作'), h('button', { disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }, '删除项目'))))),
      creating ? h(Editor, { title: '新建项目', initial: { title: '', profile: 'preview' }, fields: [['title', '新项目标题'], ['profile', '项目档次', Object.entries(profiles)]], guard, close: () => setCreating(false), save: async draft => {
        const success = await run(async () => { const project = await createProject(draft.title, draft.profile); setSelected(project.id) }); return success
      } }) : null)
  }
  Object.assign(exports, { fetchProjects, fetchProject, createProject, updateProject, deleteProject, importMaterial, ProjectPicker, ProjectList, ProjectDetail, AnchorView, StoryboardView, DeliveryView, deliveryUrl, formatSize, ShotPreview })
})
