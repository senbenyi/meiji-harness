// 职责：按任务 ID 读取并显示单个镜头的服务器预览。
window.__ModuleLoader__.load({ id: 'elysium/shot-preview', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { assetUrl } = require('elysium/media-api')
  const previews = new Map()
  function ShotPreview({ jobId, imageOnly = false }) {
    const [job, setJob] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [playing, setPlaying] = useState(false)
    useEffect(() => {
      let active = true
      setJob(null); setError(''); setPlaying(false)
      if (!jobId) return
      const key = assetUrl('status', jobId)
      if (retry) previews.delete(key)
      if (!previews.has(key)) {
        const entry = { controller: new AbortController(), users: 0, settled: false }
        entry.promise = fetch(key, { cache: 'no-store', credentials: 'same-origin', signal: entry.controller.signal }).then(async response => {
          const value = await response.json(); if (!response.ok) throw new Error(value.error || '预览读取失败'); entry.settled = true; return value
        }).catch(error => { if (previews.get(key) === entry) previews.delete(key); throw error })
        previews.set(key, entry)
        if (previews.size > 30) previews.delete(previews.keys().next().value)
      }
      const entry = previews.get(key)
      entry.users++
      entry.promise.then(value => { if (active) setJob(value); if (value.status && value.status !== 'succeeded' && previews.get(key) === entry) previews.delete(key) }).catch(err => { if (active && err.name !== 'AbortError') setError(err.message) })
      return () => { active = false; entry.users--; if (!entry.users && !entry.settled) { entry.controller.abort(); if (previews.get(key) === entry) previews.delete(key) } }
    }, [jobId, retry])
    if (!jobId) return h('p', { className: 'elysium-empty' }, '尚未关联素材')
    if (error) return h('div', { role: 'alert' }, error, h('button', { onClick: () => setRetry(value => value + 1) }, '重试预览'))
    if (!job) return h('p', { role: 'status' }, '正在加载预览…')
    if (job.media_error || job.error) return h('p', { role: 'alert' }, job.media_error || job.error)
    const media = job.has_video && !imageOnly ? playing
      ? h('video', { className: 'elysium-workbench-preview', src: assetUrl('video', jobId), controls: true, autoPlay: true, onError: () => setError('预览加载失败') })
      : h('button', { onClick: () => setPlaying(true), 'aria-label': '播放镜头视频' }, '播放视频')
      : job.has_image ? h('img', { className: 'elysium-workbench-preview', src: assetUrl('image', jobId), alt: '镜头图片', onError: () => setError('图片加载失败') }) : h('div', null, h('p', null, '暂无可播放产物'), h('button', { onClick: () => setRetry(value => value + 1) }, '刷新状态'))
    return h('div', null, media, !imageOnly && job.server?.server_id ? h('p', null, `服务器：${job.server.server_id}`) : null)
  }
  Object.assign(exports, { ShotPreview })
  return exports
} })
