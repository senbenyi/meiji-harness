window.__ModuleLoader__.load('elysium-tools/project', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { projectUrl } = require('elysium-tools/media-api')
  const { assetUrl, relativeTime, MaterialList } = require('elysium-tools/asset-list')
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
  function Field({ value, label, save, multiline, disabled }) {
    const [draft, setDraft] = useState(value)
    useEffect(() => setDraft(value), [value])
    return h(multiline ? 'textarea' : 'input', { 'aria-label': label, placeholder: label, value: draft, disabled,
      onChange: event => setDraft(event.target.value), onBlur: () => { if (draft !== value) save(draft) } })
  }
  function ShotPreview({ jobId }) {
    const [job, setJob] = useState(null), [error, setError] = useState('')
    useEffect(() => {
      let active = true
      setJob(null); setError('')
      if (jobId) fetch(assetUrl('status', jobId), { cache: 'no-store', credentials: 'same-origin' })
        .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value })
        .then(value => { if (active) setJob(value) }).catch(err => { if (active) setError(err.message) })
      return () => { active = false }
    }, [jobId])
    if (error) return h('p', { role: 'alert' }, error)
    return job?.has_video ? h('video', { className: 'elysium-asset-thumb', src: assetUrl('video', jobId), preload: 'metadata', controls: true }) : job?.has_image ? h('img', { className: 'elysium-asset-thumb', src: assetUrl('image', jobId), alt: '镜头图片' }) : h('p', null, jobId ? '暂无可播放产物' : '尚未关联素材')
  }
  function ProjectPicker({ jobId, close }) {
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    useEffect(() => { let active = true; fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [])
    async function choose(id) {
      setBusy(true); setError('')
      try { await importMaterial(id, jobId); close() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    return h('section', { role: 'dialog', 'aria-label': '选择项目' }, h('strong', null, '引入为项目锚点'),
      items.map(item => h('button', { key: item.id, disabled: busy, onClick: () => choose(item.id) }, item.title)),
      !items.length ? h('p', null, '请先在项目标签页新建项目') : null,
      error ? h('p', { role: 'alert' }, error) : null, h('button', { disabled: busy, onClick: close }, '取消'))
  }
  function AnchorView({ project, save, run, busy }) {
    const [selecting, setSelecting] = useState(null)
    const change = (index, patch) => save({ anchors: project.anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor) })
    return h('div', null,
      project.anchors.map((anchor, index) => h('article', { key: index, className: 'elysium-asset-item' },
        h(Field, { value: anchor.role, label: '锚点角色 ID', disabled: busy, save: role => save({ anchors: project.anchors.map((item, i) => i === index ? { ...item, role } : item), acts: project.acts.map(act => ({ ...act, shots: act.shots.map(shot => shot.role === anchor.role ? { ...shot, role } : shot) })) }) }),
        h(Field, { value: anchor.label, label: '锚点名称', disabled: busy, save: label => change(index, { label }) }),
        h(Field, { value: anchor.description, label: '锚点描述', multiline: true, disabled: busy, save: description => change(index, { description }) }),
        anchor.source?.job_id ? h(ShotPreview, { jobId: anchor.source.job_id }) : anchor.image_url ? h('img', { src: anchor.image_url, className: 'elysium-asset-thumb', alt: anchor.label }) : null,
        h(Field, { value: anchor.image_url, label: '参考图服务器 URL', disabled: busy, save: image_url => change(index, { image_url, source: null }) }),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor.role) }, '替换'),
        h('button', { disabled: busy, onClick: () => setSelecting(anchor.role) }, '从素材选择'))),
      selecting !== null ? h('section', { role: 'dialog', 'aria-label': '选择锚点素材' },
        h(MaterialList, { onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting); setSelecting(null); return value }) }),
        h('button', { disabled: busy, onClick: () => setSelecting(null) }, '取消')) : null,
      h('button', { disabled: busy, onClick: () => {
        let number = project.anchors.length + 1
        while (project.anchors.some(anchor => anchor.role === `role-${number}`)) number++
        save({ anchors: [...project.anchors, { role: `role-${number}`, label: '新锚点', description: '', source: null, image_url: '' }] })
      } }, '添加锚点'))
  }
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
  function StoryboardView({ project, save, busy }) {
    const [collapsed, setCollapsed] = useState({})
    const changeAct = (index, patch) => save({ acts: project.acts.map((act, i) => i === index ? { ...act, ...patch } : act) })
    const changeShot = (actIndex, index, patch) => changeAct(actIndex, { shots: project.acts[actIndex].shots.map((shot, i) => i === index ? { ...shot, ...patch } : shot) })
    function move(actIndex, index, direction) {
      const shots = [...project.acts[actIndex].shots]
      ;[shots[index], shots[index + direction]] = [shots[index + direction], shots[index]]
      changeAct(actIndex, { shots })
    }
    function removeAct(index) {
      if (!window.confirm(`删除幕“${project.acts[index].title}”及其中所有镜头？`)) return
      setCollapsed({})
      save({ acts: project.acts.filter((_, i) => i !== index) })
    }
    return h('div', null,
      project.acts.map((act, actIndex) => h('section', { key: actIndex, className: `elysium-act${collapsed[actIndex] ? ' elysium-act-collapsed' : ''}` },
        h('button', { className: 'elysium-act-header', 'aria-expanded': !collapsed[actIndex], onClick: () => setCollapsed(value => ({ ...value, [actIndex]: !value[actIndex] })) }, `${collapsed[actIndex] ? '▸' : '▾'} ${act.title} · ${act.shots.length} 镜 · ${act.shots.filter(shot => shot.status === 'succeeded').length} 完成`),
        !collapsed[actIndex] ? h('div', null,
          h(Field, { value: act.title, label: '幕标题', disabled: busy, save: title => changeAct(actIndex, { title }) }),
          h('button', { disabled: busy, onClick: () => removeAct(actIndex) }, '删除幕'),
          act.shots.map((shot, index) => {
            const anchor = project.anchors.find(item => item.role === shot.role)
            const number = project.acts.slice(0, actIndex).reduce((total, item) => total + item.shots.length, 0) + index + 1
            return h('article', { key: index, className: 'elysium-shot' },
              h('strong', null, `镜 ${String(number).padStart(3, '0')}`),
              h('span', { className: 'elysium-shot-status' }, statuses[shot.status]),
              h('div', { className: 'elysium-shot-role' }, anchor ? h('div', null,
                h('span', null, anchor.label || anchor.role),
                anchor.source?.job_id ? h(ShotPreview, { jobId: anchor.source.job_id }) : anchor.image_url ? h('img', { className: 'elysium-asset-thumb', src: anchor.image_url, alt: anchor.label }) : null,
                h('small', null, anchor.description)) : shot.role ? h('span', null, `${shot.role}（锚点不存在）`) : null),
              h('select', { 'aria-label': '镜头角色', value: shot.role, disabled: busy, onChange: event => changeShot(actIndex, index, { role: event.target.value }) },
                h('option', { value: '' }, '无角色'),
                shot.role && !anchor ? h('option', { value: shot.role }, shot.role) : null,
                project.anchors.map(item => h('option', { key: item.role, value: item.role }, item.label || item.role))),
              h(Field, { value: shot.action, label: '动作描述', multiline: true, disabled: busy, save: action => changeShot(actIndex, index, { action }) }),
              h(Field, { value: shot.subtitle, label: '字幕', disabled: busy, save: subtitle => changeShot(actIndex, index, { subtitle }) }),
              h(Field, { value: shot.mode, label: '生成模式', disabled: busy, save: mode => changeShot(actIndex, index, { mode }) }),
              h(ShotPreview, { jobId: shot.job_id }),
              h(Field, { value: shot.job_id || '', label: '关联任务 ID', disabled: busy, save: job_id => changeShot(actIndex, index, { job_id: job_id.trim() || null, status: 'pending' }) }),
              h('select', { 'aria-label': '镜头状态', value: shot.status, disabled: busy, onChange: event => changeShot(actIndex, index, { status: event.target.value }) }, Object.entries(statuses).map(([value, text]) => h('option', { key: value, value }, text))),
              h(Field, { value: shot.notes, label: '镜头备注', multiline: true, disabled: busy, save: notes => changeShot(actIndex, index, { notes }) }),
              h('div', { className: 'elysium-panel-actions' },
                h('button', { disabled: busy, title: '标记待重拍，保留旧产物供对照', onClick: () => changeShot(actIndex, index, { status: 'pending', notes: shot.notes.includes('待重拍') ? shot.notes : `${shot.notes}${shot.notes ? '\n' : ''}待重拍` }) }, '重拍'),
                h('button', { disabled: busy, onClick: () => changeShot(actIndex, index, { job_id: null, status: 'pending' }) }, '替换'),
                h('button', { disabled: busy, onClick: () => changeAct(actIndex, { shots: act.shots.filter((_, i) => i !== index) }) }, '移除'),
                h('button', { disabled: busy || index === 0, onClick: () => move(actIndex, index, -1), 'aria-label': '上移镜头' }, '↑'),
                h('button', { disabled: busy || index === act.shots.length - 1, onClick: () => move(actIndex, index, 1), 'aria-label': '下移镜头' }, '↓')))
          }),
          h('button', { disabled: busy, onClick: () => changeAct(actIndex, { shots: [...act.shots, { index: 0, role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }] }) }, '添加镜头')) : null)),
      h('button', { disabled: busy, onClick: () => save({ acts: [...project.acts, { title: `第 ${project.acts.length + 1} 幕`, shots: [] }] }) }, '添加幕'))
  }
  function deliveryUrl(item) {
    if (item.job_id) return assetUrl('download', item.job_id)
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch { /* Older project metadata may lack a server URL. */ }
    return null
  }
  function DeliveryView({ project }) {
    return h('div', null,
      !project.deliverables.length ? h('p', null, '暂无交付物') : null,
      project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(`${Number((item.size_bytes / 1024 / 1024).toFixed(2))}MB`)
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${['subtitle', 'srt', 'vtt'].includes(item.type) ? '📄' : '📦'} ${item.label}`),
          h('p', null, specs.length ? specs.join(' · ') : '规格未提供'),
          item.created_at ? h('small', null, relativeTime(item.created_at)) : null,
          url ? h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer' }, '下载') : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      }))
  }
  function ProjectDetail({ id, back }) {
    const [project, setProject] = useState(null), [tab, setTab] = useState('anchors'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchProject(id).then(value => { if (active) setProject(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id])
    async function run(action) {
      if (saving.current) return
      saving.current = true; setBusy(true); setError('')
      try { setProject(await action()) } catch (err) { setError(err.message) } finally { saving.current = false; setBusy(false) }
    }
    const save = patch => run(() => updateProject(id, patch))
    return h('div', null, h('button', { disabled: busy, onClick: back }, '返回'),
      error ? h('p', { role: 'alert' }, error) : null,
      project ? h('div', null,
        h(Field, { value: project.title, label: '项目标题', disabled: busy, save: title => save({ title }) }),
        h('div', { role: 'tablist' }, [['anchors', '锚点'], ['acts', '分镜'], ['deliverables', '交付']].map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': tab === value, disabled: busy, onClick: () => setTab(value) }, label))),
        tab === 'anchors' ? h(AnchorView, { project, save, run, busy }) : tab === 'acts' ? h(StoryboardView, { project, save, busy }) : h(DeliveryView, { project })) : h('p', null, '加载中…'))
  }
  function ProjectList() {
    const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [title, setTitle] = useState(''), [profile, setProfile] = useState('preview'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const refresh = async () => setItems(await fetchProjects())
    useEffect(() => { if (!selected) refresh().catch(err => setError(err.message)) }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    if (selected) return h(ProjectDetail, { key: selected, id: selected, back: () => setSelected(null) })
    return h('div', null,
      h('form', { onSubmit: event => { event.preventDefault(); run(async () => { const project = await createProject(title, profile); setTitle(''); setSelected(project.id) }) } },
        h('input', { 'aria-label': '新项目标题', placeholder: '新项目标题', value: title, onChange: event => setTitle(event.target.value), disabled: busy }),
        h('select', { 'aria-label': '项目档次', value: profile, disabled: busy, onChange: event => setProfile(event.target.value) }, Object.entries(profiles).map(([value, label]) => h('option', { key: value, value }, label))),
        h('button', { type: 'submit', disabled: busy || !title.trim() }, '+ 新建项目')),
      error ? h('p', { role: 'alert' }, error) : null,
      items.map(item => h('article', { className: 'elysium-asset-item', key: item.id },
        h('button', { onClick: () => setSelected(item.id), disabled: busy }, item.title),
        h('p', null, `${profiles[item.profile === 'hd' ? 'high-quality' : item.profile] || item.profile} · ${item.anchor_count} 锚点 · ${item.shot_count} 镜 · ${item.completed_count} 完成 · ${relativeTime(item.updated_at)}`),
        h('button', { disabled: busy, onClick: () => { if (window.confirm(`删除项目“${item.title}”？此操作无法撤销。`)) run(async () => { await deleteProject(item.id); await refresh() }) } }, '删除项目'))))
  }
  Object.assign(exports, { fetchProjects, fetchProject, createProject, updateProject, deleteProject, importMaterial, ProjectPicker, ProjectList, ProjectDetail, AnchorView, StoryboardView, DeliveryView, deliveryUrl })
})
