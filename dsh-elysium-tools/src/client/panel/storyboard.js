window.__ModuleLoader__.load('elysium-tools/storyboard', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl } = require('elysium-tools/media-api')
  const { assetUrl, relativeTime } = require('elysium-tools/asset-list')
  async function request(action, body, params = {}) {
    const url = mediaUrl(action, null, null, params).replace('/media/', '/storyboard/')
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '分镜操作失败')
    return value
  }
  const fetchStoryboards = () => request('list')
  const fetchStoryboard = id => request('get', null, { id })
  const createStoryboard = title => request('create', { title })
  const updateStoryboard = (id, patch) => request('update', { id, ...patch })
  const deleteStoryboard = id => request('delete', { id })
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
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
    return job?.has_video ? h('video', { className: 'elysium-asset-thumb', src: job.comfyui_view_url, preload: 'metadata', controls: true }) : job?.has_image ? h('img', { className: 'elysium-asset-thumb', src: job.comfyui_view_url, alt: '镜头图片' }) : h('p', null, jobId ? '暂无可播放产物' : '尚未关联素材')
  }
  function StoryboardDetail({ id, back }) {
    const [board, setBoard] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const saving = useRef(false)
    useEffect(() => { let active = true; fetchStoryboard(id).then(value => { if (active) setBoard(value) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [id])
    async function save(patch) {
      if (saving.current) return
      saving.current = true; setBusy(true); setError('')
      try { setBoard(await updateStoryboard(id, patch)) } catch (err) { setError(err.message) }
      finally { saving.current = false; setBusy(false) }
    }
    const change = (index, patch) => save({ shots: board.shots.map((shot, i) => i === index ? { ...shot, ...patch } : shot) })
    function move(index, direction) {
      const shots = [...board.shots]
      ;[shots[index], shots[index + direction]] = [shots[index + direction], shots[index]]
      save({ shots })
    }
    return h('div', null, h('button', { disabled: busy, onClick: back }, '返回'),
      error ? h('p', { role: 'alert' }, error) : null,
      board ? h('div', null,
        h(Field, { value: board.title, label: '分镜标题', disabled: busy, save: title => save({ title }) }),
        board.shots.map((shot, index) => h('article', { key: `${index}:${shot.job_id || ''}:${shot.label}`, className: 'elysium-asset-item' },
          h('strong', null, `镜头 ${index + 1} · ${statuses[shot.status]}`),
          h(Field, { value: shot.label, label: '镜头名称', disabled: busy, save: label => change(index, { label }) }),
          h(Field, { value: shot.prompt, label: '镜头提示词', multiline: true, disabled: busy, save: prompt => change(index, { prompt }) }),
          h(ShotPreview, { jobId: shot.job_id }),
          h(Field, { value: shot.job_id || '', label: '关联任务 ID', disabled: busy, save: job_id => change(index, { job_id: job_id.trim() || null, status: 'pending' }) }),
          h('select', { 'aria-label': '镜头状态', value: shot.status, disabled: busy, onChange: event => change(index, { status: event.target.value }) },
            Object.entries(statuses).map(([value, text]) => h('option', { key: value, value }, text))),
          h(Field, { value: shot.notes, label: '镜头备注', multiline: true, disabled: busy, save: notes => change(index, { notes }) }),
          h('div', { className: 'elysium-panel-actions' },
            h('button', { disabled: busy || index === 0, onClick: () => move(index, -1), 'aria-label': '上移镜头' }, '↑'),
            h('button', { disabled: busy || index === board.shots.length - 1, onClick: () => move(index, 1), 'aria-label': '下移镜头' }, '↓'),
            h('button', { disabled: busy, onClick: () => change(index, { job_id: null, status: 'pending' }) }, '替换'),
            h('button', { disabled: busy, onClick: () => save({ shots: board.shots.filter((_, i) => i !== index) }) }, '移除')))),
        h('button', { disabled: busy, onClick: () => save({ shots: [...board.shots, { index: board.shots.length + 1, label: '', prompt: '', job_id: null, status: 'pending', notes: '' }] }) }, '添加镜头')) : h('p', null, '加载中…'))
  }
  function StoryboardList() {
    const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [title, setTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const refresh = async () => setItems(await fetchStoryboards())
    useEffect(() => { if (!selected) refresh().catch(err => setError(err.message)) }, [selected])
    async function run(action) {
      setBusy(true); setError('')
      try { await action() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    if (selected) return h(StoryboardDetail, { key: selected, id: selected, back: () => setSelected(null) })
    return h('div', null,
      h('form', { onSubmit: event => { event.preventDefault(); run(async () => { const board = await createStoryboard(title); setTitle(''); setSelected(board.id) }) } },
        h('input', { 'aria-label': '新分镜标题', placeholder: '新分镜标题', value: title, onChange: event => setTitle(event.target.value), disabled: busy }),
        h('button', { type: 'submit', disabled: busy || !title.trim() }, '+ 新建分镜')),
      error ? h('p', { role: 'alert' }, error) : null,
      items.map(item => h('article', { className: 'elysium-asset-item', key: item.id },
        h('button', { onClick: () => setSelected(item.id), disabled: busy }, item.title),
        h('p', null, `${item.shot_count} 镜头 · ${item.completed_count} 已完成 · ${relativeTime(item.updated_at)}`),
        h('button', { disabled: busy, onClick: () => run(async () => { await deleteStoryboard(item.id); await refresh() }) }, '删除分镜'))))
  }
  Object.assign(exports, { fetchStoryboards, fetchStoryboard, createStoryboard, updateStoryboard, deleteStoryboard, StoryboardList, StoryboardDetail })
})
