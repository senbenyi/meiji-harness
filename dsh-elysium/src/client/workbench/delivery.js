// 职责：展示项目交付物规格，并提供服务器预览与下载入口。
window.__ModuleLoader__.load({ id: 'elysium/delivery', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useRef, useState } = require('react')
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
  function DeliveryView({ project }) {
    const isSubtitle = item => ['subtitle', 'srt', 'vtt'].includes(item.type)
    const [selected, setSelected] = useState(null), [error, setError] = useState(false)
    const films = project.deliverables.filter(item => !isSubtitle(item) && deliveryUrl(item))
    const item = films.find(item => deliveryUrl(item) === selected?.url) || films[0], url = item && deliveryUrl(item)
    const player = useRef(null)
    useEffect(() => {
      // 浏览器若限制程序播放，仍保留原生播放器控件供用户播放。
      if (selected) player.current?.play().catch(() => {})
    }, [selected])
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        !project.deliverables.length ? h('p', { className: 'elysium-empty' }, `尚无交付物 · ${project.acts.flatMap(act => act.shots).filter(shot => shot.status === 'succeeded').length} 镜已完成`) : !item ? h('p', { className: 'elysium-empty' }, '暂无可预览成片') : null,
        item ? h('div', null, h('h2', null, item.label), error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => setError(false) }, '重试预览')) : url ? h('video', { key: url, ref: player, 'aria-label': `成片预览 ${item.label}`, className: 'elysium-workbench-preview', src: item.job_id ? assetUrl('video', item.job_id) : url, controls: true, preload: 'metadata', onError: () => setError(true) }) : h('p', { role: 'alert' }, '缺少可播放的服务器地址')) : null),
      h('section', null, project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(formatSize(item.size_bytes))
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${isSubtitle(item) ? '字幕' : '成片'} · ${item.label}`), specs.length ? h('p', { className: 'elysium-compact-meta' }, specs.join(' · ')) : null,
          url ? h('div', { className: 'elysium-card-actions' }, !isSubtitle(item) ? h('button', { type: 'button', 'aria-label': `播放成片 ${item.label}`, onClick: () => { setSelected({ url }); setError(false) } }, '播放成片') : null,
            h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer', className: 'elysium-delivery-download', 'aria-label': `${isSubtitle(item) ? '下载字幕' : '下载视频'} ${item.label}` }, h(Icon, { name: 'download' }), isSubtitle(item) ? '下载字幕' : '下载视频')) : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      })))
  }
  Object.assign(exports, { DeliveryView, deliveryUrl })
  return exports
} })
