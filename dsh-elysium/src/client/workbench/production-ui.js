// 职责：展示七个制作阶段及可横向浏览的 Scene、Segment 和版本卡片。
window.__ModuleLoader__.load({ id: 'elysium/production-ui', factory: require => {
  const { createElement: h, useRef, useState } = require('react')
  const inputFor = s => s.inputs.findLast(i => i.source_revision === s.revision && s.shots_revision === s.revision)
  const videoFor = s => s.generations.find(g => g.id === s.selected_generation) || s.generations.findLast(g => g.status === 'succeeded')
  function Rail({ label, items, open, describe, current = () => '', empty = '尚未生成' }) {
    const ref = useRef(null), [limit, setLimit] = useState(12)
    return h('div', null, h('div', { className: 'elysium-rail-controls' },
      h('button', { 'aria-label': `${label}向左`, onClick: () => ref.current?.scrollBy({ left: -300, behavior: 'smooth' }) }, '‹'),
      h('button', { 'aria-label': `${label}向右`, onClick: () => ref.current?.scrollBy({ left: 300, behavior: 'smooth' }) }, '›')),
      h('div', { className: 'elysium-episode-rail', ref, role: 'region', 'aria-label': label }, items.slice(0, limit).map((item, i) => h('button', { key: item.id, className: 'elysium-episode-card', onClick: () => open(item), 'aria-label': `打开${label} ${i + 1}` },
        h('span', { className: 'elysium-episode-placeholder', 'aria-hidden': true }, String(i + 1).padStart(2, '0')),
        h('strong', null, item.title || `${label} ${i + 1}`), h('span', { className: 'elysium-step-status' }, current(item)), h('span', { className: 'elysium-episode-excerpt' }, describe(item))))),
      !items.length ? h('p', { className: 'elysium-empty' }, empty) : null,
      items.length > limit ? h('button', { onClick: () => setLimit(n => n + 12) }, `加载更多（${limit}/${items.length}）`) : null)
  }
  function Step({ number, title, children, next, disabled, action, progress }) {
    return h('section', { className: 'elysium-episode-section elysium-production-step' }, h('header', null, h('h2', null, `${number}. ${title}`)), children,
      progress ? h('p', { role: 'status' }, progress) : null, next ? h('footer', { className: 'elysium-series-next' }, h('button', { className: 'elysium-primary', disabled, onClick: action }, next)) : null)
  }
  return { Rail, Step, inputFor, videoFor }
} })
