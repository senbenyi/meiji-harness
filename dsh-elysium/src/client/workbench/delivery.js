// 职责：展示本集成片与字幕交付物，默认最新版，并提供本地播放与下载入口。
window.__ModuleLoader__.load({ id: 'elysium/delivery', factory: require => {
  const exports = {}
  const { createElement: h, useState } = require('react')
  const { assetUrl } = require('elysium/media-api')
  const { Icon } = require('elysium/dialog')
  const time = item => item.created_at ? new Date(item.created_at).toLocaleString() : '时间未记录'
  function DeliveryView({ project }) {
    const items = [...project.deliverables].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    const films = items.filter(item => item.type === 'film')
    const [selected, setSelected] = useState(null), [error, setError] = useState(false), [playing, setPlaying] = useState(null)
    const film = films.find(item => item.job_id === selected) || films[0]
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        films.length > 1 ? h('select', { 'aria-label': '选择成片版本', value: film.job_id, onChange: event => { setSelected(event.target.value); setError(false); setPlaying(null) } },
          films.map((item, index) => h('option', { key: item.job_id, value: item.job_id }, `${index ? '历史版' : '最新版'} · ${time(item)}`))) : null,
        !film ? h('p', { className: 'elysium-empty' }, '暂无成片') : h('div', null, h('h2', null, film.label),
          error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => { setError(false); setPlaying(null) } }, '重试预览'))
            : playing === film.job_id ? h('video', { key: film.job_id, 'aria-label': `成片预览 ${film.label}`, className: 'elysium-workbench-preview', src: assetUrl('video', film.job_id), controls: true, autoPlay: true, onError: () => setError(true) })
              : h('button', { onClick: () => setPlaying(film.job_id), 'aria-label': `播放成片 ${film.label}` }, '播放成片'))),
      h('section', null, items.map(item => {
        const subtitle = item.type === 'subtitle', specs = [time(item)]
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        return h('article', { key: item.job_id, className: 'elysium-asset-item' },
          h('strong', null, `${subtitle ? '字幕' : '成片'} · ${item.label}`), h('p', { className: 'elysium-compact-meta' }, specs.join(' · ')),
          h('div', { className: 'elysium-card-actions' },
            h('a', { href: assetUrl('download', item.job_id), download: '', target: '_blank', rel: 'noopener noreferrer', className: 'elysium-delivery-download', 'aria-label': `下载${subtitle ? '字幕' : '成片'} ${item.label}` }, h(Icon, { name: 'download' }), subtitle ? '下载字幕' : '下载成片')))
      })))
  }
  Object.assign(exports, { DeliveryView })
  return exports
} })
