// 职责：展示、编辑和替换项目角色与场景锚点。
window.__ModuleLoader__.load({ id: 'elysium/anchors', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { Dialog, Editor, Icon, IconButton } = require('elysium/dialog')
  const { MaterialList } = require('elysium/materials')
  const { ShotPreview } = require('elysium/shot-preview')
  const { importMaterial, updateAnchor } = require('elysium/project-api')
  function AnchorCreateForm({ initial, busy, save, cancel, guard }) {
    const [draft, setDraft] = useState(initial)
    const dirty = draft.label !== initial.label || draft.description !== initial.description
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
    return h('form', { className: 'elysium-anchor-create', onSubmit: submit },
      h('input', { autoFocus: true, 'aria-label': '锚点名称', placeholder: '锚点名称', value: draft.label, disabled: busy, onChange: event => setDraft({ ...draft, label: event.target.value }) }),
      h('textarea', { 'aria-label': '锚点描述', placeholder: '描述（可选）', rows: 1, value: draft.description, disabled: busy, onChange: event => setDraft({ ...draft, description: event.target.value }) }),
      h('footer', null, h(IconButton, { name: 'close', label: '取消添加锚点', disabled: busy, onClick: () => leave(cancel) }),
        h('button', { className: 'elysium-primary', type: 'submit', disabled: busy || !draft.label.trim() }, busy ? '保存中…' : '保存')))
  }
  function AnchorView({ project, run, busy, guard }) {
    const [selecting, setSelecting] = useState(null), [editing, setEditing] = useState(null), [inspecting, setInspecting] = useState(null), [creating, setCreating] = useState(null)
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
          h(IconButton, { name: 'edit', label: `编辑锚点 ${anchor.label || anchor.role}`, disabled: busy, onClick: () => setEditing(anchor) }),
          h(IconButton, { name: 'insert', label: `选择参考素材 ${anchor.label || anchor.role}`, disabled: busy, onClick: () => setSelecting(anchor) }))))),
      inspecting ? h(Dialog, { title: inspecting.label || inspecting.role, close: () => setInspecting(null) }, inspecting.image_url ? h('img', { className: 'elysium-workbench-preview', src: inspecting.image_url, alt: inspecting.label }) : h(ShotPreview, { jobId: inspecting.source?.job_id }), inspecting.description ? h('p', null, inspecting.description) : null) : null,
      selecting ? h(Dialog, { title: `为「${selecting.label || selecting.role}」选择参考素材`, close: () => setSelecting(null), busy },
        h(MaterialList, { imageOnly: true, onSelect: item => run(async () => { const value = await importMaterial(project.id, item.job_id, 'anchor', selecting.role); setSelecting(null); return value }) })) : null,
      editing ? h(Editor, { title: '编辑锚点', initial: editing, guard, fields: [['label', '锚点名称'], ['description', '锚点描述', 'textarea'], ['role', '锚点角色 ID', null, true], ['image_url', '参考图服务器 URL', null, true]], close: () => setEditing(null), save: draft => {
        const patch = Object.fromEntries(['label', 'description', 'image_url'].filter(key => draft[key] !== editing[key]).map(key => [key, draft[key]]))
        if (draft.role !== editing.role) patch.new_role = draft.role
        if (draft.image_url !== editing.image_url) patch.source = null
        return run(() => updateAnchor(project.id, 'update', { role: editing.role, ...patch }))
      } }) : null)
  }
  Object.assign(exports, { AnchorView })
  return exports
} })
