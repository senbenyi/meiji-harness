// 职责：展示、编辑和替换项目角色与场景锚点。
window.__ModuleLoader__.load({ id: 'elysium/anchors', factory: require => {
  const exports = {}
  const { createElement: h, Fragment, useEffect, useState } = require('react')
  const { Dialog, Icon, IconButton } = require('elysium/dialog')
  const { MaterialList } = require('elysium/materials')
  const { ShotPreview } = require('elysium/shot-preview')
  const { importMaterial, updateAnchor } = require('elysium/project-api')
  function AnchorCreateForm({ initial, busy, save, cancel, guard }) {
    const [draft, setDraft] = useState(initial), [selecting, setSelecting] = useState(false)
    const dirty = draft.label !== initial.label || draft.description !== initial.description || draft.source !== initial.source
    const leave = action => { if (!dirty || window.confirm('放弃未保存的锚点？')) action() }
    useEffect(() => {
      if (!guard) return
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    const submit = async event => {
      event.preventDefault()
      const label = draft.label.trim()
      if (label && await save({ ...draft, label }) !== false) cancel()
    }
    return h(Fragment, null, h('form', { className: 'elysium-anchor-create', onSubmit: submit },
      h('input', { autoFocus: true, 'aria-label': '锚点名称', placeholder: '锚点名称', value: draft.label, disabled: busy, onChange: event => setDraft({ ...draft, label: event.target.value }) }),
      h('textarea', { 'aria-label': '锚点描述', placeholder: '描述（可选）', rows: 1, value: draft.description, disabled: busy, onChange: event => setDraft({ ...draft, description: event.target.value }) }),
      h('footer', null, h(IconButton, { name: 'insert', label: '选择参考图片', disabled: busy, onClick: () => setSelecting(true) }), h(IconButton, { name: 'close', label: '取消添加锚点', disabled: busy, onClick: () => leave(cancel) }),
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.label.trim() }, busy ? '保存中…' : '保存')),
      draft.source?.job_id ? h('div', { className: 'elysium-anchor-preview', style: { gridColumn: '1 / -1' } }, h(ShotPreview, { jobId: draft.source.job_id, imageOnly: true })) : null),
      selecting ? h(Dialog, { title: '选择参考图片', busy, close: () => setSelecting(false) },
        h(MaterialList, { imageOnly: true, onSelect: item => { if (!item.has_image) return false; setDraft({ ...draft, source: { type: 'material', job_id: item.job_id }, image_url: '' }); setSelecting(false) } })) : null)
  }
  // 职责：在参考图预览中编辑锚点名称和描述，并显式保存。
  function AnchorPreview({ anchor, busy, save, close, guard, replace }) {
    const [draft, setDraft] = useState(anchor), [error, setError] = useState('')
    const dirty = draft.label !== anchor.label || draft.description !== anchor.description
    const leave = action => { if (!dirty || window.confirm('放弃未保存的锚点修改？')) action() }
    useEffect(() => {
      if (!guard) return
      guard.current = leave
      return () => { if (guard.current === leave) guard.current = null }
    }, [dirty, guard])
    async function submit() {
      setError('')
      const patch = Object.fromEntries(['label', 'description'].filter(key => draft[key] !== anchor[key]).map(key => [key, draft[key]]))
      try { if (await save({ role: anchor.role, ...patch }) === false) throw new Error('保存失败，请重试'); close() }
      catch (err) { setError(err.message) }
    }
    return h(Dialog, { title: anchor.label || anchor.role, busy, showCancel: false, close: () => leave(close), footer: h('button', { className: 'elysium-primary', disabled: busy || !draft.label.trim(), onClick: submit }, busy ? '保存中…' : '保存') },
      h('label', { className: 'elysium-field' }, h('span', null, '锚点名称'), h('input', { 'aria-label': '锚点名称', value: draft.label, disabled: busy, onChange: event => setDraft({ ...draft, label: event.target.value }) })),
      h('label', { className: 'elysium-field' }, h('span', null, '锚点描述'), h('textarea', { 'aria-label': '锚点描述', rows: 3, value: draft.description, disabled: busy, onChange: event => setDraft({ ...draft, description: event.target.value }) })),
      error ? h('p', { role: 'alert' }, error) : null,
      h('div', { className: 'elysium-anchor-preview' }, anchor.image_url ? h('img', { className: 'elysium-workbench-preview', src: anchor.image_url, alt: anchor.label }) : h(ShotPreview, { jobId: anchor.source?.job_id, imageOnly: true }),
        h(IconButton, { name: 'insert', label: '更换参考图片', disabled: busy, onClick: replace })))
  }
  function AnchorView({ project, run, busy, guard }) {
    const [selecting, setSelecting] = useState(null), [inspecting, setInspecting] = useState(null), [creating, setCreating] = useState(null)
    const startCreate = () => {
      let number = project.anchors.length + 1
      while (project.anchors.some(anchor => anchor.role === `role-${number}`)) number++
      setCreating({ role: `role-${number}`, label: '', description: '', image_url: '', source: null })
    }
    return h('div', { className: 'elysium-anchor-view' },
      h('div', { className: 'elysium-toolbar' }, h(IconButton, { name: 'plus', label: '添加锚点', disabled: busy || Boolean(creating), onClick: startCreate })),
      creating ? h(AnchorCreateForm, { initial: creating, busy, guard, cancel: () => setCreating(null), save: anchor => run(() => updateAnchor(project.id, 'add', anchor)) }) : null,
      h('div', { className: 'elysium-anchor-grid' }, project.anchors.map(anchor => h('article', { key: anchor.role, className: 'elysium-anchor-card' },
        h('div', { className: 'elysium-anchor-thumb' }, anchor.image_url ? h('img', { src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : anchor.source?.job_id ? h(ShotPreview, { jobId: anchor.source.job_id, imageOnly: true }) : h(Icon, { name: 'eye' })),
        h('div', { className: 'elysium-anchor-copy' }, h('h3', null, anchor.label || anchor.role), anchor.description ? h('p', null, anchor.description) : null),
        h('div', { className: 'elysium-card-actions' }, h(IconButton, { name: 'eye', label: `查看参考素材 ${anchor.label || anchor.role}`, onClick: () => setInspecting(anchor) }),
          h(IconButton, { name: 'minus', label: `删除锚点 ${anchor.label || anchor.role}`, disabled: busy, onClick: () => { if (window.confirm(`删除锚点“${anchor.label || anchor.role}”？`)) run(() => updateAnchor(project.id, 'delete', { role: anchor.role })) } }))))),
      inspecting ? h(AnchorPreview, { anchor: inspecting, busy, guard, replace: () => setSelecting(inspecting), close: () => setInspecting(null), save: patch => run(() => updateAnchor(project.id, 'update', patch)) }) : null,
      selecting ? h(Dialog, { title: `为「${selecting.label || selecting.role}」选择参考素材`, close: () => setSelecting(null), busy },
        h(MaterialList, { imageOnly: true, onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting.role); if (inspecting?.role === selecting.role) setInspecting(value.anchors.find(anchor => anchor.role === selecting.role)); setSelecting(null); return value }) })) : null)
  }
  Object.assign(exports, { AnchorView })
  return exports
} })
