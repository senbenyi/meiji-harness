// 职责：展示剧情总览生成的角色与场景锚点；角色可重新出图、替换参考图，全部就绪后确认锚点。
window.__ModuleLoader__.load({ id: 'elysium/anchors', factory: require => {
  const exports = {}
  const { createElement: h, useState } = require('react')
  const { Dialog, Icon, IconButton } = require('elysium/dialog')
  const { MaterialList } = require('elysium/materials')
  const { ShotPreview } = require('elysium/shot-preview')
  const { replaceAnchorImage, generateAnchorImage, confirmAnchors } = require('elysium/project-api')
  const ready = anchor => Boolean(anchor.source) && !anchor.image_needs_review
  function AnchorView({ project, run, busy }) {
    const [selecting, setSelecting] = useState(null), [inspecting, setInspecting] = useState(null)
    const active = project.anchors.filter(anchor => !anchor.retired)
    const characters = active.filter(anchor => anchor.kind === 'character'), scenes = active.filter(anchor => anchor.kind === 'scene')
    const pending = characters.filter(anchor => !ready(anchor)).length
    return h('div', { className: 'elysium-anchor-view' },
      h('div', { className: 'elysium-toolbar' },
        project.auto.anchors_confirmed ? null : h('p', { role: 'status' }, pending ? `${pending} 个角色参考图未就绪` : '参考图已就绪，确认后开始生成镜头'),
        project.auto.anchors_confirmed ? null : h('button', { type: 'button', className: 'elysium-primary', disabled: busy || !characters.length || Boolean(pending),
          onClick: () => run(() => confirmAnchors(project.id)) }, '确认锚点')),
      !characters.length ? h('p', { className: 'elysium-empty' }, '定稿剧情总览后自动生成角色锚点') : null,
      h('section', { className: 'elysium-anchor-group' }, h('h2', null, '角色锚点'), characters.map(anchor => h('article', { key: anchor.role, className: 'elysium-anchor-card' },
        h('div', { className: 'elysium-anchor-thumb' }, anchor.source?.job_id || anchor.image_job_id ? h(ShotPreview, { jobId: anchor.source?.job_id || anchor.image_job_id, imageOnly: true }) : h(Icon, { name: 'eye' })),
        h('div', { className: 'elysium-anchor-copy' }, h('h3', null, anchor.label), anchor.image_needs_review ? h('small', null, '外观已变化，参考图重新生成中') : !anchor.source ? h('small', null, anchor.image_job_id ? '参考图生成中' : '尚未出图') : null,
          h('p', null, anchor.description),
          h('div', { className: 'elysium-card-actions' },
            h('button', { type: 'button', disabled: busy, onClick: () => run(async () => generateAnchorImage(project.id, anchor.role)) }, '重新生成参考图'),
            h('button', { type: 'button', disabled: busy, onClick: () => setSelecting(anchor) }, '替换参考图'),
            anchor.source ? h(IconButton, { name: 'eye', label: `查看参考图 ${anchor.label}`, onClick: () => setInspecting(anchor) }) : null))))),
      scenes.length ? h('section', { className: 'elysium-anchor-group' }, h('h2', null, '场景'), scenes.map(anchor => h('article', { key: anchor.role, className: 'elysium-anchor-card' },
        h('div', { className: 'elysium-anchor-copy' }, h('h3', null, anchor.label), h('p', null, anchor.description))))) : null,
      inspecting ? h(Dialog, { title: inspecting.label, close: () => setInspecting(null), showCancel: false }, h(ShotPreview, { jobId: inspecting.source.job_id, imageOnly: true })) : null,
      selecting ? h(Dialog, { title: `为「${selecting.label}」选择参考图`, close: () => setSelecting(null), busy },
        h(MaterialList, { imageOnly: true, onSelect: item => run(async () => { const value = await replaceAnchorImage(project.id, selecting.role, item.job_id); setSelecting(null); return value }) })) : null)
  }
  Object.assign(exports, { AnchorView })
  return exports
} })
