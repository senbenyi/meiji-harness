// 职责：展示项目交付物规格，并提供服务器预览与下载入口。
window.__ModuleLoader__.load({ id: 'elysium/delivery', factory: require => {
  const exports = {}
  const { createElement: h, useState } = require('react')
  const { assetUrl } = require('elysium/media-api')
  const { Icon } = require('elysium/dialog')
  function deliveryUrl(item) {
    if (item.job_id) return assetUrl('download', item.job_id)
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
    } catch { /* 旧项目元数据可能没有服务器 URL。 */ }
    return null
  }
  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '大小未记录'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(2))}KB`
    return `${Number((bytes / 1024 / 1024).toFixed(2))}MB`
  }
  function DeliveryView({ project, autoPlay = false }) {
    const isSubtitle = item => ['subtitle', 'srt', 'vtt'].includes(item.type)
    const [selected, setSelected] = useState(null), [error, setError] = useState(false), [playing, setPlaying] = useState(null)
    const films = project.deliverables.filter(item => !isSubtitle(item) && deliveryUrl(item))
    const item = films.find(item => deliveryUrl(item) === selected) || films[0], url = item && deliveryUrl(item)
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        films.length > 1 ? h('select', { 'aria-label': '选择成片', value: url, onChange: event => { setSelected(event.target.value); setError(false); setPlaying(null) } }, films.map((film, index) => h('option', { key: index, value: deliveryUrl(film) }, film.label))) : null,
        !project.deliverables.length ? h('p', { className: 'elysium-empty' }, `尚无交付物 · ${project.acts.flatMap(act => act.shots).filter(shot => shot.status === 'succeeded').length} 镜已完成`) : !item ? h('p', { className: 'elysium-empty' }, '暂无可预览成片') : null,
        item ? h('div', null, h('h2', null, item.label), error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => { setError(false); setPlaying(null) } }, '重试预览')) : url ? autoPlay || playing === url
          ? h('video', { key: url, 'aria-label': `成片预览 ${item.label}`, className: 'elysium-workbench-preview', src: item.job_id ? assetUrl('video', item.job_id) : url, controls: true, autoPlay: true, onError: () => setError(true) })
          : h('button', { onClick: () => setPlaying(url), 'aria-label': `播放成片 ${item.label}` }, '播放成片') : h('p', { role: 'alert' }, '缺少可播放的服务器地址')) : null),
      h('section', null, project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(formatSize(item.size_bytes))
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${isSubtitle(item) ? '字幕' : '成片'} · ${item.label}`), specs.length ? h('p', { className: 'elysium-compact-meta' }, specs.join(' · ')) : null,
          !url ? h('p', { role: 'alert' }, '缺少可用的媒体地址') : isSubtitle(item) ? h('div', { className: 'elysium-card-actions' },
            h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer', className: 'elysium-delivery-download', 'aria-label': `下载字幕 ${item.label}` }, h(Icon, { name: 'download' }), '下载字幕')) : null)
      })))
  }
  Object.assign(exports, { DeliveryView, deliveryUrl })
  return exports
} })
