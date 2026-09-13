// 职责：展示、编辑和替换项目角色与场景锚点。
window.__ModuleLoader__.load('elysium/anchors', (require, exports) => {
  const { createElement: h, useState } = require('react')
  const { Dialog, Editor } = require('elysium/dialog')
  const { MaterialList } = require('elysium/materials')
  const { ShotPreview } = require('elysium/shot-preview')
  const { importMaterial } = require('elysium/project-api')
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
  Object.assign(exports, { AnchorView })
})
