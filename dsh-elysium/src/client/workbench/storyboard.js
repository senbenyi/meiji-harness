// 职责：管理分镜筛选、排序、编辑、素材关联与单镜预览。
window.__ModuleLoader__.load({ id: 'elysium/storyboard', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { Editor, Icon, IconButton } = require('elysium/dialog')
  const { produceShots, retryShot, updateShot, acceptShot } = require('elysium/project-api')
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
  function StoryboardView({ project, save, run, busy, episode, viewState = {}, onViewState = () => {}, guard, reviewReason = () => '' }) {
    const [state, setState] = useState({ act: '', status: '', role: '', page: 0, selected: null, ...viewState })
    const [editing, setEditing] = useState(null), scroll = useRef(null), keyboard = useRef(false)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (scroll.current) scroll.current.scrollTop = state.scroll || 0 }, [])
    const all = project.acts.flatMap((act, a) => act.shots.map((shot, i) => ({ shot, a, i, key: shot.id }))).map((item, index) => ({ ...item, number: index + 1 }))
    const matches = item => (!state.status || item.shot.status === state.status) && (!state.role || item.shot.role === state.role)
    const filtered = all.filter(item => (state.act === '' || String(item.a) === state.act) && matches(item))
    const pages = Math.max(1, Math.ceil(filtered.length / 30)), page = Math.min(state.page, pages - 1)
    const selected = all.find(item => item.key === state.selected && (state.selectedJob === undefined || item.shot.job_id === state.selectedJob)), position = filtered.findIndex(item => item.key === state.selected)
    useEffect(() => { if (keyboard.current && selected) { keyboard.current = false; scroll.current?.querySelector(`[aria-label="镜 ${String(selected.number).padStart(3, '0')}"]`)?.focus() } }, [state.selected, state.page])
    const choose = item => change({ selected: item.key, selectedJob: item.shot.job_id, page: Math.floor(filtered.indexOf(item) / 30) })
    const filter = patch => change({ ...patch, page: 0, selected: null, scroll: 0 })
    const actIndex = state.act === '' ? selected?.a ?? 0 : Number(state.act)
    const commitActs = async acts => save({ acts })
    const patchShot = async (patch, id = selected.shot.id) => {
      const ok = await run(() => updateShot(project.id, 'update', { ...patch, id, ...(episode === undefined ? {} : { episode }) }))
      if (ok && 'job_id' in patch) change({ selectedJob: patch.job_id })
      return ok
    }
    async function move(direction) {
      await run(() => updateShot(project.id, 'move', { id: selected.shot.id, direction, ...(episode === undefined ? {} : { episode }) }))
    }
    async function remove() {
      if (!window.confirm(`移除镜 ${String(selected.number).padStart(3, '0')}？`)) return
      if (await run(() => updateShot(project.id, 'delete', { id: selected.shot.id, ...(episode === undefined ? {} : { episode }) }))) change({ selected: null, selectedJob: undefined })
    }
    async function addShot() {
      let added
      const ok = await run(async () => {
        const value = await updateShot(project.id, 'add', { act_index: actIndex, ...(episode === undefined ? {} : { episode }) })
        added = value.acts[actIndex].shots.at(-1)
        return value
      })
      if (ok) change({ act: String(actIndex), status: '', role: '', selected: added.id, selectedJob: added.job_id, page: Math.floor(currentAct.shots.length / 30) })
    }
    const candidates = all.filter(item => (episode === undefined || item.shot.prompt_finalized) && (!item.shot.job_id || ['failed', 'cancelled'].includes(item.shot.status)))
    const pendingShots = candidates.filter(item => !reviewReason(item.shot)).map(item => item.shot.id)
    const batchReason = candidates.map(item => reviewReason(item.shot)).find(Boolean)
    const produce = ids => run(async () => (await produceShots(project.id, ids, undefined, episode)).project)
    const generateSelected = async () => {
      if (selected.shot.status === 'failed' && selected.shot.job_id) return run(async () => (await retryShot(project.id, selected.shot.job_id, episode)).project)
      if (selected.shot.job_id && !window.confirm('重新生成此镜？原任务记录和素材仍会保留。')) return false
      return produce([selected.shot.id])
    }
    const select = (label, key, options) => h('select', { 'aria-label': label, value: state[key], onChange: e => filter({ [key]: e.target.value }) }, options.map(([value, text]) => h('option', { key: value, value }, text)))
    const { ShotPreview } = require('elysium/shot-preview')
    const anchor = selected && project.anchors.find(item => item.role === selected.shot.role)
    const selectedReason = selected && reviewReason(selected.shot)
    const currentAct = project.acts[actIndex]
    const copy = (title, value) => value ? h('section', { className: 'elysium-shot-copy' }, h('h3', null, title), h('p', null, value)) : null
    const shotFields = [
      ['role', '镜头角色', project.anchors.map(anchor => [anchor.role, anchor.label || anchor.role])], ['action', '动作描述', 'textarea'], ['subtitle', '字幕', 'textarea'], ['notes', '镜头备注', 'textarea'],
    ]
    return h('div', { className: `elysium-storyboard${selected ? ' has-selection' : ''}` },
      h('nav', { className: 'elysium-acts', 'aria-label': '幕导航' },
        h('button', { 'aria-pressed': state.act === '', onClick: () => filter({ act: '' }) }, `全部 ${all.length}`),
        project.acts.map((act, a) => h('button', { key: a, 'aria-pressed': state.act === String(a), onClick: () => filter({ act: String(a) }) }, `${a + 1}. ${act.title} · ${act.shots.filter(s => s.status === 'succeeded').length}/${act.shots.length}`)),
        h(IconButton, { name: 'plus', label: '添加幕', disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) })),
      h('div', { className: 'elysium-shot-list' },
        h('div', { className: 'elysium-toolbar' },
          select('幕', 'act', [['', '全部'], ...project.acts.map((act, a) => [String(a), act.title])]),
          select('状态', 'status', [['', '全部'], ...Object.entries(statuses)]), select('角色', 'role', [['', '全部'], ...project.anchors.map(a => [a.role, a.label || a.role])]),
          h('button', { 'aria-label': '生成全部待处理镜头', disabled: busy || !pendingShots.length || Boolean(batchReason), title: batchReason || undefined,
            onClick: () => produce(pendingShots) }, `生成全部待处理镜头${pendingShots.length ? ` (${pendingShots.length})` : ''}`),
          h(IconButton, { name: 'plus', label: '添加幕', className: 'elysium-mobile-act', disabled: busy, onClick: () => setEditing({ kind: 'new-act', title: `第 ${project.acts.length + 1} 幕` }) })),
        batchReason ? h('p', { role: 'status' }, batchReason) : null,
        h('div', { className: 'elysium-shot-rows', ref: scroll, tabIndex: 0, role: 'region', 'aria-label': '镜头列表', onScroll: e => { onViewState({ ...state, scroll: e.currentTarget.scrollTop }) } },
          !filtered.length ? h('p', null, '无匹配镜头') : null,
          filtered.slice(page * 30, page * 30 + 30).map(item => {
            const anchor = project.anchors.find(a => a.role === item.shot.role)
            return h('button', { key: item.key, className: 'elysium-shot-row', 'aria-label': `镜 ${String(item.number).padStart(3, '0')}`, 'aria-pressed': item.key === state.selected, onClick: () => choose(item), onKeyDown: e => {
              if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); keyboard.current = true; const next = filtered[Math.max(0, Math.min(filtered.length - 1, filtered.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1)))]; choose(next) }
            } }, h('b', null, String(item.number).padStart(3, '0')), h('span', { className: 'elysium-shot-status', 'data-status': item.shot.status, role: 'img', 'aria-label': statuses[item.shot.status], title: statuses[item.shot.status] }), h('span', null, anchor?.label || item.shot.role || '—'), h('span', { className: 'elysium-shot-summary' }, `${item.shot.accepted ? '✓ 已采用 · ' : ''}${item.shot.action || ''}`))
          })),
        h('footer', { className: 'elysium-pagination' }, h('span', null, `${page + 1}/${pages}`), h(IconButton, { name: 'chevronLeft', label: '上一页', disabled: page === 0, onClick: () => change({ page: page - 1 }) }), h(IconButton, { name: 'chevronRight', label: '下一页', disabled: page + 1 === pages, onClick: () => change({ page: page + 1 }) }),
          currentAct ? h('details', { className: 'elysium-icon-menu' }, h('summary', { 'aria-label': '幕操作', title: '幕操作' }, h(Icon, { name: 'more' })), h('button', { disabled: busy, onClick: () => setEditing({ kind: 'act', title: currentAct.title }) }, '修改幕标题'),
            h('button', { disabled: busy, onClick: async () => { if (window.confirm(`删除幕“${currentAct.title}”及其中所有镜头？`) && await commitActs(project.acts.filter((_, a) => a !== actIndex))) filter({ act: '', selected: null }) } }, '删除幕'),
            h('button', { disabled: busy, onClick: addShot }, '添加镜头')) : null)),
      h('aside', { className: 'elysium-shot-detail' }, selected ? h('div', null,
        h('div', { className: 'elysium-shot-heading' }, h(IconButton, { name: 'back', label: '返回镜头列表', onClick: () => change({ selected: null }) }), h('h2', null, `镜 ${String(selected.number).padStart(3, '0')} · ${project.acts[selected.a].title}`),
          h('div', { className: 'elysium-panel-actions' }, h(IconButton, { name: 'chevronLeft', label: '上一镜', disabled: position <= 0, onClick: () => choose(filtered[position - 1]) }), h(IconButton, { name: 'chevronRight', label: '下一镜', disabled: position < 0 || position >= filtered.length - 1, onClick: () => choose(filtered[position + 1]) }))),
        editing ? null : h(ShotPreview, { jobId: selected.shot.job_id }),
        h('p', { className: 'elysium-compact-meta' }, `${statuses[selected.shot.status]} · ${selected.shot.accepted ? '已采用 · ' : ''}${anchor?.label || selected.shot.role || '无角色'}`), anchor ? h('details', null, h('summary', null, '角色参考'), anchor.image_url ? h('img', { className: 'elysium-workbench-preview', src: anchor.image_url, alt: anchor.label, loading: 'lazy' }) : null, anchor.description ? h('p', null, anchor.description) : null) : null,
        selectedReason ? h('p', { role: 'status' }, selectedReason) : null,
        copy('动作', selected.shot.action), copy('场景与运镜', [selected.shot.scene, selected.shot.shot_size, selected.shot.camera].filter(Boolean).join(' · ')),
        copy('定稿提示词', selected.shot.prompt), copy('字幕', selected.shot.subtitle), copy('备注', selected.shot.notes),
        h('div', { className: 'elysium-card-actions' }, h('button', { disabled: busy || Boolean(selectedReason) || episode !== undefined && !selected.shot.prompt_finalized || ['queued', 'running'].includes(selected.shot.status) || selected.shot.status === 'pending' && selected.shot.job_id, title: selectedReason || undefined,
          onClick: generateSelected }, selected.shot.status === 'failed' ? '恢复此镜任务' : selected.shot.job_id ? '重新生成此镜' : '生成此镜'),
        episode !== undefined ? h('button', { type: 'button', disabled: busy || selected.shot.status !== 'succeeded',
          onClick: () => run(() => acceptShot(project.id, episode, selected.shot.id, !selected.shot.accepted)) }, selected.shot.accepted ? '取消采用' : '采用此镜') : null,
        h(IconButton, { name: 'edit', label: '编辑镜头', disabled: busy, onClick: () => setEditing({ kind: 'shot', ...selected.shot }) }),
        h('details', { className: 'elysium-icon-menu' }, h('summary', { 'aria-label': '更多操作', title: '更多操作' }, h(Icon, { name: 'more' })),
          selected.shot.job_id && !['succeeded', 'cancelled'].includes(selected.shot.status) ? h('button', { disabled: busy, onClick: () => { if (window.confirm('仅当任务失败或 Driver 提示需要人工恢复时继续。确认恢复当前任务？')) run(async () => (await retryShot(project.id, selected.shot.job_id, episode)).project) } }, '人工恢复当前任务') : null,
          h('button', { disabled: busy, onClick: () => patchShot({ status: 'pending', notes: [selected.shot.notes, '待重拍'].filter(Boolean).join('\n') }) }, '标记待重拍'),
          h('button', { disabled: busy, onClick: () => { if (window.confirm('解除素材关联？旧素材仍保留在素材库。')) patchShot({ job_id: null, status: 'pending' }) } }, '解除素材关联'),
          h('button', { disabled: busy || selected.i === 0 || Boolean(state.role || state.status), onClick: () => move(-1), title: '当前幕内移动，筛选时不可用' }, '上移'),
          h('button', { disabled: busy || selected.i === project.acts[selected.a].shots.length - 1 || Boolean(state.role || state.status), onClick: () => move(1) }, '下移'), h('button', { disabled: busy, onClick: remove }, '移除镜头'))),
        h('details', null, h('summary', null, '技术详情'), h('p', null, `模式：${selected.shot.mode}`), h('p', null, `任务 ID：${selected.shot.job_id || '未关联'}`), h('p', null, `状态：${statuses[selected.shot.status]}`))) : h('p', { className: 'elysium-empty' }, '选择一个镜头，查看画面与详情')),
      editing ? h(Editor, { title: editing.kind === 'shot' ? '编辑镜头' : '编辑幕', initial: editing, fields: editing.kind === 'shot' ? shotFields : [['title', '幕标题']], guard, close: () => setEditing(null), save: async draft => {
        if (editing.kind === 'shot') {
          const patch = Object.fromEntries(shotFields.map(([key]) => key).filter(key => draft[key] !== editing[key]).map(key => [key, draft[key]]))
          return patchShot(patch, editing.id)
        }
        return commitActs(editing.kind === 'new-act' ? [...project.acts, { title: draft.title, shots: [] }] : project.acts.map((act, a) => a === actIndex ? { ...act, title: draft.title } : act))
      } }) : null)
  }
  Object.assign(exports, { StoryboardView })
  return exports
} })
