// 职责：按集浏览镜头状态与画面，提供重拍与恢复；镜头内容只由规划定稿产生。
window.__ModuleLoader__.load({ id: 'elysium/storyboard', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { IconButton } = require('elysium/dialog')
  const { ShotPreview } = require('elysium/shot-preview')
  const { reshootShot, retryShot } = require('elysium/project-api')
  const statuses = { pending: '待生成', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
  const statusOf = shot => shot.status === 'pending' && shot.job_id ? '生成中' : statuses[shot.status]
  const running = shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && Boolean(shot.job_id)
  function StoryboardView({ project, episode, run, busy, viewState = {}, onViewState = () => {} }) {
    const [state, setState] = useState({ status: '', page: 0, selected: null, ...viewState })
    const scroll = useRef(null), keyboard = useRef(false)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (scroll.current) scroll.current.scrollTop = state.scroll || 0 }, [])
    const all = project.acts.flatMap(act => act.shots).map((shot, index) => ({ shot, key: shot.id, number: index + 1 }))
    const filtered = all.filter(item => !state.status || item.shot.status === state.status)
    const pages = Math.max(1, Math.ceil(filtered.length / 30)), page = Math.min(state.page, pages - 1)
    const selected = all.find(item => item.key === state.selected), position = filtered.findIndex(item => item.key === state.selected)
    const label = item => `镜 ${String(item.number).padStart(3, '0')}`
    useEffect(() => { if (keyboard.current && selected) { keyboard.current = false; scroll.current?.querySelector(`[aria-label="${label(selected)}"]`)?.focus() } }, [state.selected, state.page])
    const choose = item => change({ selected: item.key, page: Math.floor(filtered.indexOf(item) / 30) })
    const anchorLabel = role => project.anchors.find(anchor => anchor.role === role)?.label || role
    const copy = (title, value) => value ? h('section', { className: 'elysium-shot-copy' }, h('h3', null, title), h('p', null, value)) : null
    const done = all.filter(item => item.shot.status === 'succeeded').length
    return h('div', { className: `elysium-storyboard${selected ? ' has-selection' : ''}` },
      h('div', { className: 'elysium-shot-list' },
        h('div', { className: 'elysium-toolbar' },
          h('select', { 'aria-label': '状态', value: state.status, onChange: event => change({ status: event.target.value, page: 0, selected: null, scroll: 0 }) },
            [['', '全部'], ...Object.entries(statuses)].map(([value, text]) => h('option', { key: value, value }, text))),
          h('span', { role: 'status' }, `${done}/${all.length} 镜完成`)),
        h('div', { className: 'elysium-shot-rows', ref: scroll, tabIndex: 0, role: 'region', 'aria-label': '镜头列表', onScroll: event => onViewState({ ...state, scroll: event.currentTarget.scrollTop }) },
          !filtered.length ? h('p', null, '无匹配镜头') : null,
          filtered.slice(page * 30, page * 30 + 30).map(item => h('button', { key: item.key, className: 'elysium-shot-row', 'aria-label': label(item), 'aria-pressed': item.key === state.selected, onClick: () => choose(item), onKeyDown: event => {
            if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault(); keyboard.current = true
            choose(filtered[Math.max(0, Math.min(filtered.length - 1, filtered.indexOf(item) + (event.key === 'ArrowDown' ? 1 : -1)))])
          } }, h('b', null, String(item.number).padStart(3, '0')), h('span', { className: 'elysium-shot-status', 'data-status': item.shot.status, role: 'img', 'aria-label': statusOf(item.shot), title: statusOf(item.shot) }),
          h('span', null, item.shot.roles.map(anchorLabel).join('、') || '空镜'), h('span', { className: 'elysium-shot-summary' }, item.shot.action)))),
        h('footer', { className: 'elysium-pagination' }, h('span', null, `${page + 1}/${pages}`), h(IconButton, { name: 'chevronLeft', label: '上一页', disabled: page === 0, onClick: () => change({ page: page - 1 }) }), h(IconButton, { name: 'chevronRight', label: '下一页', disabled: page + 1 === pages, onClick: () => change({ page: page + 1 }) }))),
      h('aside', { className: 'elysium-shot-detail' }, selected ? h('div', null,
        h('div', { className: 'elysium-shot-heading' }, h(IconButton, { name: 'back', label: '返回镜头列表', onClick: () => change({ selected: null }) }), h('h2', null, `${label(selected)} · 第 ${episode} 集`),
          h('div', { className: 'elysium-panel-actions' }, h(IconButton, { name: 'chevronLeft', label: '上一镜', disabled: position <= 0, onClick: () => choose(filtered[position - 1]) }), h(IconButton, { name: 'chevronRight', label: '下一镜', disabled: position < 0 || position >= filtered.length - 1, onClick: () => choose(filtered[position + 1]) }))),
        h(ShotPreview, { jobId: selected.shot.job_id }),
        h('p', { className: 'elysium-compact-meta' }, `${statusOf(selected.shot)} · ${selected.shot.duration} 秒 · 第 ${selected.shot.take} 条`),
        h('div', { className: 'elysium-card-actions' },
          h('button', { type: 'button', className: 'elysium-primary', disabled: busy || !selected.shot.job_id || running(selected.shot),
            onClick: () => { if (window.confirm('重拍此镜？将用新种子重新生成首帧与视频，原素材仍保留在素材库。')) run(() => reshootShot(project.id, episode, selected.shot.id)) } }, '重拍此镜'),
          selected.shot.status === 'failed' ? h('button', { type: 'button', disabled: busy, title: '仅用于首帧已完成、视频因服务故障失败的镜头',
            onClick: () => run(() => retryShot(project.id, episode, selected.shot.id)) }, '恢复原任务') : null),
        copy('动作', selected.shot.action), copy('场景与运镜', [anchorLabel(`scene-${selected.shot.scene}`), selected.shot.shot_size, selected.shot.camera].filter(Boolean).join(' · ')),
        copy('对白', selected.shot.dialogue.map(line => `${anchorLabel(line.role)}：${line.text}`).join('\n')), copy('视频提示词', selected.shot.prompt),
        selected.shot.keyframe_job_id ? h('details', null, h('summary', null, '首帧'), h(ShotPreview, { jobId: selected.shot.keyframe_job_id, imageOnly: true }), copy('首帧提示词', selected.shot.keyframe_prompt)) : copy('首帧提示词', selected.shot.keyframe_prompt),
        h('details', null, h('summary', null, '技术详情'), h('p', null, `视频任务：${selected.shot.job_id || '未提交'}`), h('p', null, `首帧任务：${selected.shot.keyframe_job_id || '未提交'}`))) : h('p', { className: 'elysium-empty' }, '选择一个镜头，查看画面与详情')))
  }
  Object.assign(exports, { StoryboardView })
  return exports
} })
