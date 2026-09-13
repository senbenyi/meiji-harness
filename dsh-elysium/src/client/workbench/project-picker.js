// 职责：让用户选择项目，并将已选素材导入为项目锚点。
window.__ModuleLoader__.load('elysium/project-picker', (require, exports) => {
  const { createElement: h, useEffect, useState } = require('react')
  const { Dialog } = require('elysium/dialog')
  const { fetchProjects, importMaterial } = require('elysium/project-api')
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
  Object.assign(exports, { ProjectPicker })
})
