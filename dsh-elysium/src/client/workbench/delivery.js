// 职责：展示项目交付物规格，并提供服务器预览与下载入口。
window.__ModuleLoader__.load({ id: 'elysium/delivery', factory: require => { const exports = {}
  const { createElement: h, useState } = require('react')
  const { assetUrl, relativeTime } = require('elysium/materials')
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
    const item = project.deliverables[selected], url = item && deliveryUrl(item)
    return h('div', { className: 'elysium-delivery' },
      h('section', { className: 'elysium-delivery-preview' },
        !project.deliverables.length ? h('p', { className: 'elysium-empty' }, `尚无交付物 · ${project.acts.flatMap(act => act.shots).filter(shot => shot.status === 'succeeded').length} 镜已完成`) : !item ? h('p', { className: 'elysium-empty' }, '选择成片，开始审看') : null,
        item ? h('div', null, h('h2', null, item.label), error ? h('p', { role: 'alert' }, '成片预览加载失败', h('button', { onClick: () => setError(false) }, '重试预览')) : url ? h('video', { key: url, className: 'elysium-workbench-preview', src: item.job_id ? assetUrl('video', item.job_id) : url, controls: true, preload: 'metadata', onError: () => setError(true) }) : h('p', { role: 'alert' }, '缺少可播放的服务器地址')) : null),
      h('section', null, h('h2', null, '交付文件'), project.deliverables.map((item, index) => {
        const url = deliveryUrl(item), specs = []
        if (Number.isFinite(item.duration_sec)) specs.push(`${item.duration_sec}秒`)
        if (Number.isFinite(item.frame_count)) specs.push(`${item.frame_count}帧`)
        if (Number.isFinite(item.size_bytes)) specs.push(formatSize(item.size_bytes))
        return h('article', { key: index, className: 'elysium-asset-item' },
          h('strong', null, `${isSubtitle(item) ? '字幕' : '成片'} · ${item.label}`), h('p', null, specs.join(' · ') || '规格未提供'),
          item.created_at ? h('small', null, relativeTime(item.created_at)) : null,
          !isSubtitle(item) && url ? h('button', { onClick: () => { setSelected(index); setError(false) } }, '审看成片') : null,
          url ? h('a', { href: url, download: '', target: '_blank', rel: 'noopener noreferrer' }, '下载') : h('p', { role: 'alert' }, '缺少可下载的服务器地址'))
      })))
  }
  Object.assign(exports, { DeliveryView, deliveryUrl, formatSize })
return exports
} })
