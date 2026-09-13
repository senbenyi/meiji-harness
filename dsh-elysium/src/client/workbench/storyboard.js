// 职责：管理分镜筛选、排序、编辑、素材关联与单镜预览。
window.__ModuleLoader__.load({ id: 'elysium/storyboard', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { Editor } = require('elysium/dialog')
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
  function StoryboardView({ project, save, busy, viewState = {}, onViewState = () => {}, guard }) {
    const [state, setState] = useState({ act: '', q: '', status: '', role: '', page: 0, selected: null, ...viewState })
    const [editing, setEditing] = useState(null), scroll = useRef(null), keyboard = useRef(false)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (scroll.current) scroll.current.scrollTop = state.scroll || 0 }, [])
    const all = project.acts.flatMap((act, a) => act.shots.map((shot, i) => ({ shot, a, i, key: `${a}:${i}` }))).map((item, index) => ({ ...item, number: index + 1 }))
    const matches = item => (!state.q || [String(item.number), String(item.number).padStart(3, '0'), item.shot.action, item.shot.subtitle].some(text => text?.toLowerCase().includes(state.q.toLowerCase()))) && (!state.status || item.shot.status === state.status) && (!state.role || item.shot.role === state.role)
    const filtered = all.filter(item => (state.act === '' || String(item.a) === state.act) && matches(item))
    const pages = Math.max(1, Math.ceil(filtered.length / 30)), page = Math.min(state.page, pages - 1)
    const selected = all.find(item => item.key === state.selected && (state.selectedJob === undefined || item.shot.job_id === state.selectedJob)), position = filtered.findIndex(item => item.key === state.selected)
    useEffect(() => { if (keyboard.current && selected) { keyboard.current = false; scroll.current?.querySelector(`[aria-label="镜 ${String(selected.number).padStart(3, '0')}"]`)?.focus() } }, [state.selected, state.page])
    const choose = item => change({ selected: item.key, selectedJob: item.shot.job_id, page: Math.floor(filtered.indexOf(item) / 30) })
    const filter = patch => change({ ...patch, page: 0, selected: null, scroll: 0 })
    const actIndex = state.act === '' ? selected?.a ?? 0 : Number(state.act)
    const commitActs = async acts => save({ acts })
    const patchShot = async patch => { const ok = await commitActs(project.acts.map((act, a) => a === selected.a ? { ...act, shots: act.shots.map((shot, i) => i === selected.i ? { ...shot, ...patch } : shot) } : act)); if (ok && 'job_id' in patch) change({ selectedJob: patch.job_id }); return ok }
    async function move(direction) {
      const acts = project.acts.map((act, a) => ({ ...act, shots: [...act.shots] }))
      const shots = acts[selected.a].shots, target = selected.i + direction
      ;[shots[selected.i], shots[target]] = [shots[target], shots[selected.i]]
      if (await commitActs(acts)) change({ selected: `${selected.a}:${target}`, selectedJob: shots[target].job_id })
    }
    async function remove() {
      if (!window.confirm(`移除镜 ${String(selected.number).padStart(3, '0')}？`)) return
      const acts = project.acts.map((act, a) => a === selected.a ? { ...act, shots: act.shots.filter((_, i) => i !== selected.i) } : act)
      if (await commitActs(acts)) change({ selected: null, selectedJob: undefined })
    }
    const select = (label, key, options) => h('label', null, label, h('select', { 'aria-label': label, value: state[key], onChange: e => filter({ [key]: e.target.value }) }, options.map(([value, label]) => h('option', { key: value, value }, label))))
    const { ShotPreview } = require('elysium/shot-preview')
    const anchor = selected && project.anchors.find(item => item.role === selected.shot.role)
    const currentAct = project.acts[actIndex]
    const shotFields = [
      ['role', '镜头角色', project.anchors.map(anchor => [anchor.role, anchor.label || anchor.role])], ['action', '动作描述', 'textarea'], ['subtitle', '字幕', 'textarea'], ['notes', '镜头备注', 'textarea'],
      ['mode', '生成模式', null, true], ['job_id', '关联任务 ID', null, true], ['status', '镜头状态', Object.entries(statuses)],
    ]
    return h('div', { className: `elysium-storyboard${selected ? ' has-selection' : ''}` },
      h('nav', { className: 'elysium-acts', 'aria-label': '幕导航' }, h('h3', null, '幕'),
        h('button', { 'aria-pressed': state.act === '', onClick: () => filter({ act: '' }) }, `全部 ${all.length}`),
        project.acts.map((act, a) => h('button', { key: a, 'aria-pressed': state.act === String(a), onClick: () => filter({ act: String(a) }) }, `${a + 1}. ${act.title} · ${act.shots.filter(s => s.status === 'succeeded').length}/${act.shots.length}`)),
        h('button', { disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) }, '添加幕')),
      h('div', { className: 'elysium-shot-list' },
        h('div', { className: 'elysium-toolbar' },
          h('input', { 'aria-label': '搜索镜头', placeholder: '镜号、动作或字幕', value: state.q, onChange: e => filter({ q: e.target.value }) }),
          select('幕', 'act', [['', '全部幕'], ...project.acts.map((act, a) => [String(a), act.title])]),
          select('状态', 'status', [['', '全部状态'], ...Object.entries(statuses)]), select('角色', 'role', [['', '全部角色'], ...project.anchors.map(a => [a.role, a.label || a.role])]),
          h('button', { className: 'elysium-mobile-act', disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) }, '添加幕'), h('span', null, `${filtered.length} 镜`), h('button', { onClick: () => filter({ q: '', act: '', status: '', role: '' }) }, '清空筛选')),
        h('div', { className: 'elysium-shot-rows', ref: scroll, tabIndex: 0, role: 'region', 'aria-label': '镜头列表', onScroll: e => { onViewState({ ...state, scroll: e.currentTarget.scrollTop }) } },
          !filtered.length ? h('p', null, '无匹配镜头', state.q && state.act !== '' ? h('button', { onClick: () => filter({ act: '', role: '', status: '' }) }, '在全部镜头中定位') : null) : null,
          filtered.slice(page * 30, page * 30 + 30).map(item => {
            const anchor = project.anchors.find(a => a.role === item.shot.role)
            return h('button', { key: item.key, className: 'elysium-shot-row', 'aria-label': `镜 ${String(item.number).padStart(3, '0')}`, 'aria-pressed': item.key === state.selected, onClick: () => choose(item), onKeyDown: e => {
              if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); keyboard.current = true; const next = filtered[Math.max(0, Math.min(filtered.length - 1, filtered.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1)))]; choose(next) }
            } }, h('b', null, String(item.number).padStart(3, '0')), h('span', { className: 'elysium-shot-icon' }, item.shot.job_id ? '▶' : '—'), h('span', null, anchor?.label || item.shot.role || '无角色'), h('span', { className: 'elysium-shot-summary' }, item.shot.action || '未填写动作'), h('small', null, statuses[item.shot.status]))
          })),
        h('footer', { className: 'elysium-pagination' }, h('span', null, `第 ${page + 1}/${pages} 页`), h('button', { disabled: page === 0, onClick: () => change({ page: page - 1 }) }, '上一页'), h('button', { disabled: page + 1 === pages, onClick: () => change({ page: page + 1 }) }, '下一页'),
          currentAct ? h('details', null, h('summary', null, '幕操作'), h('button', { disabled: busy, onClick: () => setEditing({ kind: 'act', title: currentAct.title }) }, '修改幕标题'),
            h('button', { disabled: busy, onClick: async () => { if (window.confirm(`删除幕“${currentAct.title}”及其中所有镜头？`) && await commitActs(project.acts.filter((_, a) => a !== actIndex))) filter({ act: '', selected: null }) } }, '删除幕'),
            h('button', { disabled: busy, onClick: async () => { const shot = { index: 0, role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }; if (await commitActs(project.acts.map((act, a) => a === actIndex ? { ...act, shots: [...act.shots, shot] } : act))) change({ act: String(actIndex), q: '', status: '', role: '', selected: `${actIndex}:${currentAct.shots.length}`, page: Math.floor(currentAct.shots.length / 30) }) } }, '添加镜头')) : null)),
      h('aside', { className: 'elysium-shot-detail' }, selected ? h('div', null,
        h('button', { onClick: () => change({ selected: null }) }, '返回镜头列表'), h('h2', null, `镜 ${String(selected.number).padStart(3, '0')} · ${project.acts[selected.a].title}`),
        h('div', { className: 'elysium-panel-actions' }, h('button', { disabled: position <= 0, onClick: () => choose(filtered[position - 1]) }, '上一镜'), h('button', { disabled: position < 0 || position >= filtered.length - 1, onClick: () => choose(filtered[position + 1]) }, '下一镜')),
        editing ? null : h(ShotPreview, { jobId: selected.shot.job_id }),
        h('p', null, `${statuses[selected.shot.status]} · ${anchor?.label || selected.shot.role || '无角色'}`), anchor ? h('details', null, h('summary', null, '角色参考'), anchor.image_url ? h('img', { className: 'elysium-workbench-preview', src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : null, h('p', null, anchor.description)) : null, h('h3', null, '动作'), h('p', null, selected.shot.action || '未填写'), h('h3', null, '字幕'), h('p', null, selected.shot.subtitle || '未填写'), h('h3', null, '备注'), h('p', null, selected.shot.notes || '无'),
        h('button', { className: 'elysium-primary', disabled: busy, onClick: () => setEditing({ kind: 'shot', ...selected.shot }) }, '编辑镜头'),
        h('details', null, h('summary', null, '更多操作'),
          h('button', { disabled: busy, onClick: () => patchShot({ status: 'pending', notes: [selected.shot.notes, '待重拍'].filter(Boolean).join('\n') }) }, '标记待重拍'),
          h('button', { disabled: busy, onClick: () => { if (window.confirm('解除素材关联？旧素材仍保留在素材库。')) patchShot({ job_id: null, status: 'pending' }) } }, '解除素材关联'),
          h('button', { disabled: busy || selected.i === 0 || Boolean(state.q || state.role || state.status), onClick: () => move(-1), title: '当前幕内移动，筛选时不可用' }, '上移'),
          h('button', { disabled: busy || selected.i === project.acts[selected.a].shots.length - 1 || Boolean(state.q || state.role || state.status), onClick: () => move(1) }, '下移'), h('button', { disabled: busy, onClick: remove }, '移除镜头')),
        h('details', null, h('summary', null, '技术详情'), h('p', null, `模式：${selected.shot.mode}`), h('p', null, `任务 ID：${selected.shot.job_id || '未关联'}`))) : h('p', { className: 'elysium-empty' }, '选择一个镜头，查看画面与详情')),
      editing ? h(Editor, { title: editing.kind === 'shot' ? '编辑镜头' : '编辑幕', initial: editing, fields: editing.kind === 'shot' ? shotFields : [['title', '幕标题']], guard, close: () => setEditing(null), save: async draft => {
        if (editing.kind === 'shot') { const { kind, ...patch } = draft; patch.job_id = patch.job_id?.trim() || null; if (patch.job_id !== selected.shot.job_id) patch.status = 'pending'; return patchShot(patch) }
        return commitActs(editing.kind === 'new-act' ? [...project.acts, { title: draft.title, shots: [] }] : project.acts.map((act, a) => a === actIndex ? { ...act, title: draft.title } : act))
      } }) : null)
  }
  Object.assign(exports, { StoryboardView })
  return exports
} })
