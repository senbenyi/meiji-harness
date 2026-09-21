// 职责：导入、查询、预览、选择和删除素材。
window.__ModuleLoader__.load({ id: 'elysium/materials', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl, assetUrl, relativeTime } = require('elysium/media-api')
  const { specificationLabel } = require('elysium/media-task-state')
  const { IconButton } = require('elysium/dialog')
  const DEFAULT_PAGE_SIZE = 24
  async function fetchAssets(offset = 0, limit = DEFAULT_PAGE_SIZE, filters = {}, signal) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin', signal })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  const listCache = new Map()
  const assetTitle = item => item.title || item.prompt_excerpt || (item.has_video ? '视频' : '图片')
  function MaterialList({ onSelect, imageOnly = false, viewState = {}, onViewState = () => {} } = {}) {
    const [state, setState] = useState({ source: 'creation', quality: '', media_kind: '', q: '', page: 0, page_size: DEFAULT_PAGE_SIZE, ...viewState, ...(imageOnly ? { media_kind: 'image' } : {}) })
    const [input, setInput] = useState(state.q), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
    const [preview, setPreview] = useState(null), [missing, setMissing] = useState({}), [submitting, setSubmitting] = useState(false), [mediaError, setMediaError] = useState(false), [deleting, setDeleting] = useState(false), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('')
    const sequence = useRef(0), grid = useRef(null), fileInput = useRef(null)
    const pageSize = Number(state.page_size) || DEFAULT_PAGE_SIZE
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (input === state.q) return; const timer = setTimeout(() => change({ q: input, page: 0 }), 250); return () => clearTimeout(timer) }, [input, state.q])
    useEffect(() => {
      const controller = new AbortController(), request = ++sequence.current
      let key
      try { key = mediaUrl('list', null, null, { ...state, scroll: 0 }) }
      catch (error) {
        setError(error.message); setBusy(false)
        return () => { ++sequence.current; controller.abort() }
      }
      const cached = listCache.get(key)
      if (cached && Date.now() - cached.time < 30000) { setData(cached.value); setBusy(false); setError(''); return () => { ++sequence.current; controller.abort() } }
      setBusy(true); setError(''); setData(cached?.value || null)
      fetchAssets(state.page * pageSize, pageSize, { source: state.source, quality: state.quality, media_kind: state.media_kind, q: state.q }, controller.signal).then(value => {
        if (request === sequence.current) { listCache.set(key, { value, time: Date.now() }); if (listCache.size > 8) listCache.delete(listCache.keys().next().value); setData(value); if (grid.current) grid.current.scrollTop = state.scroll || 0 }
      }).catch(err => { if (!controller.signal.aborted && request === sequence.current) setError(err.message) }).finally(() => { if (request === sequence.current) setBusy(false) })
      return () => { ++sequence.current; controller.abort() }
    }, [state.source, state.quality, state.media_kind, state.q, state.page, pageSize, retry])
    useEffect(() => { if (grid.current && data) grid.current.scrollTop = state.scroll || 0 }, [data])
    const select = (label, key, options) => h('select', { 'aria-label': label, value: state[key], onChange: event => change({ [key]: event.target.value, page: 0, scroll: 0 }) }, options.map(([value, text]) => h('option', { key: value, value }, text)))
    async function upload(event) {
      const files = Array.from(event.target.files || [])
      event.target.value = ''
      if (!files.length) return
      setUploading(true); setUploadError('')
      try {
        for (const file of files) {
          const response = await fetch(mediaUrl('upload', null, null, { filename: file.name }), { method: 'POST', credentials: 'same-origin', body: file })
          const value = await response.json()
          if (!response.ok) throw new Error(value.error || '素材导入失败')
        }
      } catch (err) { setUploadError(err.message) } finally {
        listCache.clear(); setData(null); setInput('')
        change({ source: 'import', page: 0, scroll: 0, quality: '', media_kind: imageOnly ? 'image' : '', q: '' })
        setRetry(value => value + 1); setUploading(false)
      }
    }
    async function choose() {
      if (submitting || imageOnly && !preview?.has_image) return
      setSubmitting(true); setError('')
      try { if (await onSelect(preview) === false) throw new Error('素材写入失败，请重试'); setPreview(null) } catch (err) { setError(err.message) } finally { setSubmitting(false) }
    }
    async function remove(item) {
      if (deleting || !window.confirm(`删除素材“${assetTitle(item)}”？已有项目仍可使用此素材。`)) return
      setDeleting(true); setError('')
      try {
        const response = await fetch(assetUrl('delete', item.job_id), { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || '素材删除失败')
        listCache.clear()
        setData(null)
        if (preview?.job_id === item.job_id) setPreview(null)
        if (data.items.length === 1 && state.page > 0) change({ page: state.page - 1, scroll: 0 })
        else setRetry(value => value + 1)
      } catch (err) { setError(err.message) } finally { setDeleting(false) }
    }
    const pages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
    const media = (item, large) => !large && missing[item.job_id] ? h('span', { className: 'elysium-material-missing' }, '文件缺失') : item.has_video && !(large ? false : item.has_image)
      ? h('video', { src: `${assetUrl('video', item.job_id)}${large ? '' : '#t=0.1'}`, preload: 'metadata', muted: !large, playsInline: true, ...(large ? { controls: true, autoPlay: true, onError: () => setMediaError(true) } : { 'aria-hidden': true }) })
      : h('img', { src: assetUrl('image', item.job_id), alt: large ? assetTitle(item) : '', loading: 'lazy', onError: () => large ? setMediaError(true) : setMissing(current => ({ ...current, [item.job_id]: true })) })
    return h('div', { className: 'elysium-materials' },
      h('nav', { className: 'elysium-segments', role: 'tablist', 'aria-label': '素材分类' }, [['creation', '创作素材'], ['project', '项目素材'], ['import', '导入素材']].map(([source, label]) => h('button', { key: source, type: 'button', role: 'tab', 'aria-selected': state.source === source, 'aria-current': state.source === source ? 'true' : undefined, onClick: () => { setData(null); setPreview(null); change({ source, page: 0, scroll: 0 }) } }, label))),
      h('div', { className: 'elysium-page-heading' },
        h('input', { type: 'file', ref: fileInput, hidden: true, multiple: true, accept: imageOnly ? '.png,.jpg,.jpeg,.webp' : '.png,.jpg,.jpeg,.webp,.mp4', 'aria-label': '选择导入文件', disabled: uploading, onChange: upload }),
        h('input', { type: 'search', className: 'elysium-material-search', 'aria-label': '搜索素材', placeholder: '搜索提示词或文件名', value: input, onChange: e => setInput(e.target.value) }),
        imageOnly ? null : select('类型', 'media_kind', [['', '全部类型'], ['video', '视频'], ['image', '图片']]),
        select('创作质量', 'quality', [['', '全部质量'], ['fast', '快速创作'], ['regular', '常规创作'], ['high', '高清创作']]),
        h('button', { type: 'button', className: 'elysium-primary', 'aria-label': imageOnly ? '导入图片素材' : '导入素材', disabled: uploading, onClick: () => fileInput.current.click() }, uploading ? '导入中…' : imageOnly ? '＋ 导入图片' : '＋ 导入素材')),
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error, h('button', { onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '重试')) : null,
      uploadError ? h('p', { className: 'elysium-banner', role: 'alert' }, uploadError) : null,
      // 选中的素材在列表上方原地展开，不弹窗。
      preview ? h('section', { className: 'elysium-material-detail', 'aria-label': '素材预览' },
        h('div', { className: 'elysium-material-detail-media' }, mediaError ? h('p', { role: 'alert' }, '预览加载失败', h('button', { onClick: () => setMediaError(false) }, '重试预览')) : media(preview, true)),
        h('div', { className: 'elysium-material-detail-copy' },
          h('b', null, assetTitle(preview)),
          h('small', { className: 'elysium-compact-meta' }, `${specificationLabel(preview) || (preview.has_video ? '视频' : '图片')} · ${relativeTime(preview.created_at)}`),
          preview.prompt_excerpt && preview.prompt_excerpt !== assetTitle(preview) ? h('p', null, preview.prompt_excerpt) : null,
          h('div', { className: 'elysium-page-heading' },
            onSelect ? h('button', { type: 'button', className: 'elysium-primary', disabled: submitting || imageOnly && !preview.has_image, onClick: choose }, submitting ? '正在使用…' : '使用此素材') : null,
            h('a', { href: assetUrl('download', preview.job_id), download: '' }, '下载'),
            h('button', { type: 'button', className: 'elysium-link elysium-danger', disabled: deleting, onClick: () => remove(preview) }, '删除'),
            h('button', { type: 'button', className: 'elysium-link', 'aria-label': '关闭预览', onClick: () => setPreview(null) }, '收起')))) : null,
      !data && !error ? h('p', { className: 'elysium-empty', role: 'status' }, '正在加载素材…') : null,
      data?.items.length === 0 ? h('p', { className: 'elysium-empty' }, state.q || state.quality || state.media_kind ? '没有匹配的素材，请调整筛选条件' : '暂无素材') : null,
      h('div', { className: 'elysium-material-grid', ref: grid, onScroll: e => onViewState({ ...state, scroll: e.currentTarget.scrollTop }) },
        data?.items.map(item => h('article', { key: item.job_id, className: 'elysium-material-card', 'aria-current': preview?.job_id === item.job_id ? 'true' : undefined },
          h('button', { type: 'button', className: 'elysium-card-open', onClick: () => { setPreview(item); setMediaError(false) }, 'aria-label': `查看素材 ${assetTitle(item)}` },
            h('span', { className: 'elysium-material-thumb' }, media(item, false), item.has_video ? h('span', { className: 'elysium-material-kind' }, '▶ 视频') : null),
            h('span', { className: 'elysium-material-title' }, assetTitle(item)),
            h('small', { className: 'elysium-compact-meta' }, relativeTime(item.created_at))),
          h(IconButton, { name: 'close', label: `删除素材 ${assetTitle(item)}`, className: 'elysium-danger elysium-material-delete', disabled: busy || deleting, onClick: () => remove(item) })))),
      h('footer', { className: 'elysium-pagination' },
        h('span', { role: 'status' }, busy || !data ? '正在读取…' : `共 ${data.total ?? data.items.length} 条`),
        h('div', { className: 'elysium-pagination-actions' }, select('每页', 'page_size', [[24, '24 条/页'], [48, '48 条/页'], [96, '96 条/页']]),
          h(IconButton, { name: 'chevronLeft', label: '上一页', disabled: busy || state.page === 0, onClick: () => change({ page: state.page - 1, scroll: 0 }) }),
          h('span', null, `${state.page + 1} / ${pages}`),
          h(IconButton, { name: 'chevronRight', label: '下一页', disabled: busy || state.page + 1 >= pages, onClick: () => change({ page: state.page + 1, scroll: 0 }) }))))
  }
  Object.assign(exports, { MaterialList })
  return exports
} })
