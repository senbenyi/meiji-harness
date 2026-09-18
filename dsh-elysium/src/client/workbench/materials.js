// 职责：导入、查询、预览、选择和删除素材，并将素材导入目标项目。
window.__ModuleLoader__.load({ id: 'elysium/materials', factory: require => {
  const exports = {}
  const { createElement: h, useState, useEffect, useRef } = require('react')
  const { mediaUrl, assetUrl, relativeTime, saveMaterial } = require('elysium/media-api')
  const { specificationLabel } = require('elysium/media-task-state')
  const { Dialog, Editor, Icon, IconButton } = require('elysium/dialog')
  const { fetchProjects, importMaterial } = require('elysium/project-api')
  const { DirectorList } = require('elysium/directors')
  const categories = [['character', '人物'], ['scene', '场景'], ['prop', '道具'], ['theme', '题材'], ['director', '导演']]
  const DEFAULT_PAGE_SIZE = 6
  async function fetchAssets(offset = 0, limit = DEFAULT_PAGE_SIZE, filters = {}, signal) {
    const response = await fetch(mediaUrl('list', null, null, { offset, limit, ...filters }), { cache: 'no-store', credentials: 'same-origin', signal })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '素材读取失败')
    return value
  }
  const listCache = new Map()
  const assetTitle = item => item.title || item.prompt_excerpt || `${item.has_video ? '视频' : '图片'} · ${(item.id || item.job_id).slice(0, 8)}`
  function ProjectPicker({ jobId, close }) {
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [loading, setLoading] = useState(true)
    useEffect(() => { let active = true; fetchProjects().then(value => { if (active) setItems(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
    async function choose() {
      if (busy || !selected) return
      setBusy(true); setError('')
      try { await importMaterial(selected, jobId); close() } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    return h(Dialog, { title: '选择项目', close, busy, footer: h('button', { className: 'elysium-primary', disabled: busy || !selected, onClick: choose }, busy ? '正在使用…' : '用作项目锚点') },
      items.map(item => h('button', { key: item.id, disabled: busy, 'aria-pressed': selected === item.id, onClick: () => setSelected(item.id) }, item.title)),
      loading ? h('p', { role: 'status' }, '正在读取项目…') : !items.length ? h('p', null, '请先在项目页新建项目') : null,
      error ? h('p', { role: 'alert' }, error) : null)
  }
  function MaterialList(props = {}) {
    const [viewState, setViewState] = useState({ ...props.viewState, category: props.viewState?.category || 'character' })
    const category = viewState.category
    const change = patch => { const next = { ...viewState, ...patch }; setViewState(next); props.onViewState?.(next) }
    return h('div', { className: 'elysium-materials' },
      h('div', { className: 'elysium-material-tabs', role: 'tablist', 'aria-label': '素材分类' }, categories.filter(([value]) => !props.imageOnly || !['theme', 'director'].includes(value)).map(([value, label]) => h('button', { key: value, role: 'tab', 'aria-selected': category === value, onClick: () => change({ category: value, page: 0, scroll: 0 }) }, label))),
      category === 'director' ? h(DirectorList) : h(MaterialGrid, { ...props, viewState, onViewState: change, key: category, category }))
  }
  function MaterialGrid({ category, onSelect, imageOnly = false, viewState = {}, onViewState = () => {} } = {}) {
    const [state, setState] = useState({ source: '', profile: '', media_kind: '', q: '', page: 0, page_size: DEFAULT_PAGE_SIZE, ...viewState, ...(imageOnly ? { media_kind: 'image' } : {}) })
    const [input, setInput] = useState(state.q), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
    const [preview, setPreview] = useState(null), [importJob, setImportJob] = useState(null), [submitting, setSubmitting] = useState(false), [mediaError, setMediaError] = useState(false), [deleting, setDeleting] = useState(false), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('')
    const [editing, setEditing] = useState(null)
    const sequence = useRef(0), grid = useRef(null), fileInput = useRef(null)
    const pageSize = Number(state.page_size) || DEFAULT_PAGE_SIZE
    const isTheme = category === 'theme'
    const change = patch => { const next = { ...state, ...patch }; setState(next); onViewState(next) }
    useEffect(() => { if (input === state.q) return; const timer = setTimeout(() => change({ q: input, page: 0 }), 250); return () => clearTimeout(timer) }, [input, state.q])
    useEffect(() => {
      const controller = new AbortController(), request = ++sequence.current
      let key
      try { key = mediaUrl('list', null, null, { ...state, category, scroll: 0 }) }
      catch (error) {
        setError(error.message); setBusy(false)
        return () => { ++sequence.current; controller.abort() }
      }
      const cached = listCache.get(key)
      if (cached && Date.now() - cached.time < 30000) { setData(cached.value); setBusy(false); setError(''); return () => { ++sequence.current; controller.abort() } }
      setBusy(true); setError(''); setData(cached?.value || null)
      fetchAssets(state.page * pageSize, pageSize, { category, source: state.source, profile: state.profile, media_kind: state.media_kind, q: state.q }, controller.signal).then(value => {
        if (request === sequence.current) { listCache.set(key, { value, time: Date.now() }); if (listCache.size > 8) listCache.delete(listCache.keys().next().value); setData(value); if (grid.current) grid.current.scrollTop = state.scroll || 0 }
      }).catch(err => { if (!controller.signal.aborted && request === sequence.current) setError(err.message) }).finally(() => { if (request === sequence.current) setBusy(false) })
      return () => { ++sequence.current; controller.abort() }
    }, [category, state.source, state.profile, state.media_kind, state.q, state.page, pageSize, retry])
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
          await saveMaterial({ id: value.job_id, title: file.name, category, description: '', prompt: '' })
        }
      } catch (err) { setUploadError(err.message) } finally {
        listCache.clear(); setData(null); setInput('')
        change({ source: 'import', page: 0, scroll: 0, profile: '', media_kind: imageOnly ? 'image' : '', q: '' })
        setRetry(value => value + 1); setUploading(false)
      }
    }
    async function choose() {
      if (submitting || imageOnly && !preview?.has_image) return
      setSubmitting(true); setError('')
      try { if (await onSelect(preview) === false) throw new Error('素材写入失败，请重试'); setPreview(null) } catch (err) { setError(err.message) } finally { setSubmitting(false) }
    }
    async function chooseItem(item) {
      if (submitting) return
      setSubmitting(true); setError('')
      try { if (await onSelect(item) === false) throw new Error('素材写入失败，请重试') } catch (err) { setError(err.message) } finally { setSubmitting(false) }
    }
    async function remove(item) {
      if (deleting || !window.confirm(`删除${isTheme ? '题材' : '素材'}“${assetTitle(item)}”？已有项目仍可使用此素材。`)) return
      setDeleting(true); setError('')
      try {
        const response = await fetch(mediaUrl('delete', null, null, { id: item.id || item.job_id }), { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || '素材删除失败')
        listCache.clear()
        setData(null)
        if ((preview?.id || preview?.job_id) === (item.id || item.job_id)) setPreview(null)
        if (data.items.length === 1 && state.page > 0) change({ page: state.page - 1, scroll: 0 })
        else setRetry(value => value + 1)
      } catch (err) { setError(err.message) } finally { setDeleting(false) }
    }
    const editorFields = isTheme || editing?.category === 'theme'
      ? [['title', '题材名称']]
      : [['title', '素材名称'], ['category', '素材分类', categories.filter(([value]) => value !== 'director')], ['description', '描述与连续性要求', 'textarea'], ['prompt', '图片生成提示词', 'textarea']]
    return h('div', { className: 'elysium-materials' },
      h('div', { className: 'elysium-toolbar' },
        h(IconButton, { name: 'plus', label: isTheme ? '新建题材' : '新建文字素材', onClick: () => setEditing({ title: '', category, description: '', prompt: '' }) }),
        isTheme ? null : h(IconButton, { name: 'insert', label: imageOnly ? '导入图片素材' : '导入素材', disabled: uploading, onClick: () => fileInput.current.click() }),
        isTheme ? null : h('input', { type: 'file', ref: fileInput, hidden: true, multiple: true, accept: imageOnly ? '.png,.jpg,.jpeg,.webp' : '.png,.jpg,.jpeg,.webp,.mp4', 'aria-label': '选择导入文件', disabled: uploading, onChange: upload }),
        h('input', { type: 'search', 'aria-label': isTheme ? '搜索题材' : '搜索素材', placeholder: '搜索', value: input, onChange: e => setInput(e.target.value) }),
        isTheme ? null : select('档次', 'profile', [['', '全部档次'], ['preview', '预览'], ['regular', '常规'], ['high-quality', '高清']]),
        isTheme ? null : select('来源', 'source', [['', '全部来源'], ['creation', '创作素材'], ['project', '项目素材'], ['import', '导入素材']]),
        isTheme || imageOnly ? null : select('类型', 'media_kind', [['', '全部'], ['video', '视频'], ['image', '图片'], ['text', '文字']])),
      error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => { listCache.clear(); setRetry(x => x + 1) } }, '重试')) : null,
      uploadError ? h('p', { role: 'alert' }, uploadError) : null,
      uploading ? h('p', { role: 'status' }, '正在导入素材…') : null,
      busy ? h('div', { className: 'elysium-empty', role: 'status' }, '正在加载素材…') : null,
      data?.items.length === 0 ? h('p', { className: 'elysium-empty' }, state.q || state.profile || state.media_kind ? '无匹配素材，请调整筛选条件' : isTheme ? '暂无题材标签' : '暂无已完成素材') : null,
      h('div', { className: isTheme ? 'elysium-theme-grid' : 'elysium-material-grid', ref: grid, onScroll: e => onViewState({ ...state, scroll: e.currentTarget.scrollTop }) },
        isTheme
          ? data?.items.map(item => h('article', { key: item.id || item.job_id, className: 'elysium-theme-tag' },
            h('button', { type: 'button', className: 'elysium-theme-label', onClick: () => onSelect ? chooseItem(item) : setEditing(item), 'aria-label': `题材 ${assetTitle(item)}` }, assetTitle(item)),
            h(IconButton, { name: 'edit', label: `编辑题材 ${assetTitle(item)}`, onClick: () => setEditing(item) }),
            h(IconButton, { name: 'minus', label: `删除题材 ${assetTitle(item)}`, disabled: busy || deleting, onClick: () => remove(item) })))
          : data?.items.map(item => h('article', { key: item.id || item.job_id, className: 'elysium-material-card' },
          h('button', { className: 'elysium-card-open', onClick: () => { setPreview(item); setMediaError(false) }, 'aria-label': `查看素材 ${assetTitle(item)}` },
            item.has_image ? h('img', { src: assetUrl('image', item.job_id, { preview: 1 }), alt: assetTitle(item), loading: 'lazy' }) : h('div', { className: 'elysium-video-placeholder', 'aria-hidden': true }, item.has_video ? '视频' : (item.description || '文字素材').slice(0, 120)),
            h('strong', null, assetTitle(item))), h('small', { className: 'elysium-compact-meta' }, `${specificationLabel(item) || (item.has_image ? '图片' : item.has_video ? '视频' : '文字')} · ${relativeTime(item.created_at)}`),
          h('div', { className: 'elysium-card-actions' }, h(IconButton, { name: 'edit', label: `编辑素材 ${assetTitle(item)}`, onClick: () => setEditing(item) }),
          h(IconButton, { name: 'minus', label: `删除素材 ${assetTitle(item)}`, disabled: busy || deleting, onClick: () => remove(item) }))))),
      h('footer', { className: 'elysium-pagination' },
        h('div', { className: 'elysium-pagination-meta' }, select('每页', 'page_size', [[6, '6 条'], [9, '9 条'], [12, '12 条'], [15, '15 条']]), h('span', { role: 'status' }, busy ? '正在读取…' : `共 ${data?.total ?? data?.items.length ?? 0} 条`)),
        h('div', { className: 'elysium-pagination-actions' }, h('span', null, `${state.page + 1}/${Math.max(1, Math.ceil((data?.total || 0) / pageSize))}`), h(IconButton, { name: 'chevronLeft', label: '上一页', disabled: busy || state.page === 0, onClick: () => change({ page: state.page - 1, scroll: 0 }) }), h(IconButton, { name: 'chevronRight', label: '下一页', disabled: busy || !data?.has_more, onClick: () => change({ page: state.page + 1, scroll: 0 }) }))),
      preview && !importJob ? h(Dialog, { title: assetTitle(preview), close: () => setPreview(null), busy: submitting, footer: onSelect ? h('button', { disabled: submitting || imageOnly && !preview.has_image, className: 'elysium-primary', onClick: choose }, submitting ? '正在使用…' : '使用此素材') : preview.has_image ? h('button', { onClick: () => setImportJob(preview.job_id) }, '用作项目锚点') : null },
        !preview.has_image && !preview.has_video ? null : mediaError ? h('p', { role: 'alert' }, '预览加载失败', h('button', { onClick: () => setMediaError(false) }, '重试预览')) : h(preview.has_video ? 'video' : 'img', { className: 'elysium-workbench-preview', src: assetUrl(preview.has_video ? 'video' : 'image', preview.job_id, preview.has_image ? { preview: 1 } : {}), ...(preview.has_video ? { controls: true, preload: 'metadata' } : { alt: assetTitle(preview) }), onError: () => setMediaError(true) }),
        h('p', { style: { whiteSpace: 'pre-wrap' } }, preview.description || preview.prompt_excerpt || ''),
        h('small', null, `素材编号：${preview.id || preview.job_id}`),
        preview.prompt ? h('details', null, h('summary', null, '图片生成提示词'), h('p', null, preview.prompt)) : null,
        h('button', { onClick: async () => { try { await navigator.clipboard.writeText(`${assetTitle(preview)}\n素材编号：${preview.id || preview.job_id}\n${preview.description || preview.prompt_excerpt || ''}`) } catch { setError('复制失败，请手动选择文字复制') } } }, '复制参考信息'), error ? h('p', { role: 'alert' }, error) : null,
        preview.has_download ? h('a', { href: assetUrl('download', preview.job_id), download: '', className: 'elysium-icon-link', 'aria-label': '下载素材', title: '下载素材' }, h(Icon, { name: 'download' })) : null) : null,
      editing ? h(Editor, { title: editing.category === 'theme' ? (editing.id ? '编辑题材' : '新建题材') : (editing.id ? '编辑素材' : '新建文字素材'), initial: editing, fields: editorFields, save: async draft => { await saveMaterial(draft); listCache.clear(); setRetry(value => value + 1) }, close: () => setEditing(null) }) : null,
      importJob ? h(ProjectPicker, { jobId: importJob, close: () => setImportJob(null) }) : null)
  }
  Object.assign(exports, { MaterialList, fetchAssets })
  return exports
} })
