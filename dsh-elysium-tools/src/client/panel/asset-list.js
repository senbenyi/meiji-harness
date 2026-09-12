window.__ModuleLoader__.load('elysium-tools/asset-list', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl } = require('elysium-tools/media-api')
  const { specificationLabel } = require('elysium-tools/media-model')
  const assetUrl = (kind, job) => mediaUrl(kind, null, null, { job })
  async function fetchAssets(offset = 0, limit = 50, filters = {}) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin' })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  function relativeTime(time) {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
    return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
  }
  function MaterialItems({ filters, onSelect }) {
    const [items, setItems] = useState([]), [more, setMore] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    const [importJob, setImportJob] = useState(null)
    const sentinel = useRef(null), loading = useRef(false), alive = useRef(false)
    async function load() {
      if (loading.current || !more) return
      loading.current = true; setBusy(true); setError('')
      try {
        const data = await fetchAssets(items.length, 50, filters)
        if (alive.current) { setItems(previous => [...previous, ...data.items]); setMore(data.has_more) }
      } catch (err) { if (alive.current) setError(err.message) }
      finally { loading.current = false; if (alive.current) setBusy(false) }
    }
    useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, [])
    useEffect(() => {
      if (!more || error || busy || typeof IntersectionObserver === 'undefined') return
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load() })
      if (sentinel.current) observer.observe(sentinel.current)
      return () => observer.disconnect()
    }, [items, more, error, busy])
    return h('div', null,
      items.map((item, index) => h('article', { key: item.job_id, className: 'elysium-asset-item' },
        item.has_video ? h('video', { className: 'elysium-asset-thumb', src: assetUrl('video', item.job_id), preload: 'metadata', controls: true }) : item.has_image ? h('img', { className: 'elysium-asset-thumb', src: assetUrl('image', item.job_id), alt: '生成图片' }) : null,
        h('div', null, `${index + 1}. ${specificationLabel(item) || '已完成素材'}`), h('small', null, relativeTime(item.created_at)), ' ',
        item.has_video || item.has_image ? h('a', { href: assetUrl('download', item.job_id), download: '' }, '下载') : null,
        h('button', { className: 'elysium-import-btn', onClick: () => onSelect ? onSelect(item) : setImportJob(item.job_id) }, onSelect ? '选择' : '→项目'))),
      importJob ? h(require('elysium-tools/project').ProjectPicker, { jobId: importJob, close: () => setImportJob(null) }) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      !busy && !items.length && !error ? h('p', null, '暂无已完成素材') : null,
      more ? h('button', { ref: sentinel, disabled: busy, onClick: load }, busy ? '加载中…' : error ? '重试' : '加载更多') : null)
  }
  function MaterialList({ onSelect } = {}) {
    const [profile, setProfile] = useState(''), [media_kind, setKind] = useState('')
    const select = (label, value, change, options) => h('select', { className: 'elysium-filter-select', 'aria-label': label, value, onChange: event => change(event.target.value) }, options.map(([value, text]) => h('option', { key: value, value }, text)))
    return h('div', null,
      h('div', { className: 'elysium-filter-bar' },
        select('档次', profile, setProfile, [['', '全部档次'], ['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]),
        select('类型', media_kind, setKind, [['', '全部类型'], ['video', '视频'], ['image', '图片']])),
      h(MaterialItems, { key: `${profile}:${media_kind}`, filters: { profile, media_kind }, onSelect }))
  }
  Object.assign(exports, { MaterialList, fetchAssets, assetUrl, relativeTime })
})
