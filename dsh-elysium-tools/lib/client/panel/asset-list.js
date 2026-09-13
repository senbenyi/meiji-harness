window.__ModuleLoader__.load('elysium-tools/asset-list', (require, exports) => {
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl } = require('elysium-tools/media-api')
  const { specificationLabel } = require('elysium-tools/media-model')
  const { Dialog } = require('elysium-tools/dialog')
  const assetUrl = (kind, job) => mediaUrl(kind, null, null, { job })
  async function fetchAssets(offset = 0, limit = 30, filters = {}, signal) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin', signal })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  function relativeTime(time) {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
    return !Number.isFinite(minutes) ? '时间未记录' : minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
  }
  const listCache = new Map()
  const assetTitle = item => item.title || item.prompt_excerpt || `${item.has_video ? '视频' : '图片'} · ${item.job_id.slice(0, 8)}`
  function MaterialList({ onSelect, viewState = {}, onViewState = () => {} } = {}) {
    const [state, setState] = useState({ profile: '', media_kind: '', q: '', page: 0, ...viewState })
    const [input, setInput] = useState(state.q), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
    const [preview, setPreview] = useState(null), [importJob, setImportJob] = useState(null), [submitting, setSubmitting] = useState(false), [mediaError, setMediaError] = useState(false)
    const sequence = useRef(0), grid = useRef(null)
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (input === state.q) return; const timer = setTimeout(() => change({ q: input, page: 0 }), 250); return () => clearTimeout(timer) }, [input, state.q])
    useEffect(() => {
      const controller = new AbortController(), request = ++sequence.current
      const key = mediaUrl('list', null, null, { ...state, scroll: 0 })
      const cached = listCache.get(key)
      if (cached && Date.now() - cached.time < 30000) { setData(cached.value); setBusy(false); setError(''); return () => { ++sequence.current; controller.abort() } }
      setBusy(true); setError(''); setData(cached?.value || null)
      fetchAssets(state.page * 30, 30, { profile: state.profile, media_kind: state.media_kind, q: state.q }, controller.signal).then(value => {
        if (request === sequence.current) { listCache.set(key, { value, time: Date.now() }); if (listCache.size > 8) listCache.delete(listCache.keys().next().value); setData(value); if (grid.current) grid.current.scrollTop = state.scroll || 0 }
      }).catch(err => { if (!controller.signal.aborted && request === sequence.current) setError(err.message) }).finally(() => { if (request === sequence.current) setBusy(false) })
      return () => { ++sequence.current; controller.abort() }
    }, [state.profile, state.media_kind, state.q, state.page, retry])
    useEffect(() => { if (grid.current && data) grid.current.scrollTop = state.scroll || 0 }, [data])
    const select = (label, key, options) => h('label', null, label, h('select', { 'aria-label': label, value: state[key], onChange: event => change({ [key]: event.target.value, page: 0, scroll: 0 }) }, options.map(([value, text]) => h('option', { key: value, value }, text))))
    async function choose() {
      if (submitting) return
      setSubmitting(true); setError('')
      try { if (await onSelect(preview) === false) throw new Error('素材写入失败，请重试'); setPreview(null) } catch (err) { setError(err.message) } finally { setSubmitting(false) }
    }
    return h('div', { className: 'elysium-materials' },
      h('div', { className: 'elysium-toolbar' }, h('input', { type: 'search', 'aria-label': '搜索素材', placeholder: '搜索描述或任务 ID', value: input, onChange: e => setInput(e.target.value) }),
        select('档次', 'profile', [['', '全部档次'], ['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]),
        select('类型', 'media_kind', [['', '全部类型'], ['video', '视频'], ['image', '图片']]),
        h('span', { role: 'status' }, busy ? '正在读取…' : `共 ${data?.total ?? data?.items.length ?? 0} 项`),
        h('button', { onClick: () => { setInput(''); change({ profile: '', media_kind: '', q: '', page: 0, scroll: 0 }) } }, '清空筛选'), h('button', { disabled: busy, onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '刷新素材')),
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '重试')) : null,
      busy ? h('div', { className: 'elysium-empty', role: 'status' }, '正在加载素材…') : null,
      data?.items.length === 0 ? h('p', { className: 'elysium-empty' }, state.q || state.profile || state.media_kind ? '无匹配素材，请调整筛选条件' : '暂无已完成素材') : null,
      h('div', { className: 'elysium-material-grid', ref: grid, onScroll: e => onViewState({ ...state, scroll: e.currentTarget.scrollTop }) },
        data?.items.map(item => h('article', { key: item.job_id, className: 'elysium-material-card' },
          h('button', { className: 'elysium-card-open', onClick: () => { setPreview(item); setMediaError(false) }, 'aria-label': `查看素材 ${assetTitle(item)}` },
            item.has_image ? h('img', { src: assetUrl('image', item.job_id), alt: assetTitle(item), loading: 'lazy' }) : h('div', { className: 'elysium-video-placeholder' }, '▶', h('small', null, '点击预览视频')),
            h('strong', null, assetTitle(item))), h('small', null, specificationLabel(item) || (item.has_image ? '图片' : '视频')), h('small', null, relativeTime(item.created_at))))),
      h('footer', { className: 'elysium-pagination' }, h('span', null, `第 ${state.page + 1}/${Math.max(1, Math.ceil((data?.total || 0) / 30))} 页`), h('button', { disabled: busy || state.page === 0, onClick: () => change({ page: state.page - 1, scroll: 0 }) }, '上一页'), h('button', { disabled: busy || !data?.has_more, onClick: () => change({ page: state.page + 1, scroll: 0 }) }, '下一页')),
      preview && !importJob ? h(Dialog, { title: assetTitle(preview), close: () => setPreview(null), busy: submitting, footer: onSelect ? h('button', { disabled: submitting, className: 'elysium-primary', onClick: choose }, submitting ? '正在使用…' : '使用此素材') : h('button', { onClick: () => setImportJob(preview.job_id) }, '用作项目锚点') },
        mediaError ? h('p', { role: 'alert' }, '预览加载失败', h('button', { onClick: () => setMediaError(false) }, '重试预览')) : h(preview.has_video ? 'video' : 'img', { className: 'elysium-workbench-preview', src: assetUrl(preview.has_video ? 'video' : 'image', preview.job_id), ...(preview.has_video ? { controls: true, preload: 'metadata' } : { alt: assetTitle(preview) }), onError: () => setMediaError(true) }),
        h('p', null, preview.prompt_excerpt || '未记录描述'), error ? h('p', { role: 'alert' }, error) : null,
        h('a', { href: assetUrl('download', preview.job_id), download: '' }, '下载')) : null,
      importJob ? h(require('elysium-tools/project').ProjectPicker, { jobId: importJob, close: () => setImportJob(null) }) : null)
  }
  Object.assign(exports, { MaterialList, fetchAssets, assetUrl, relativeTime, assetTitle })
})
