// 职责：调用导演库 HTTP 端点，不包含视图状态。
window.__ModuleLoader__.load({ id: 'elysium/director-api', factory: require => {
  const exports = {}
  function directorUrl(action) {
    const config = window.__ELYSIUM_MEDIA__
    if (!config?.token || !config.directorBase) throw new Error('导演服务未加载，请刷新页面或检查服务')
    const query = new URLSearchParams({ t: config.token })
    return `${config.directorBase}/${action}?${query}`
  }
  async function request(action, body) {
    const response = await fetch(directorUrl(action), { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '导演操作失败')
    return value
  }
  const fetchDirectors = () => request('list')
  const createDirector = director => request('create', director)
  const updateDirector = director => request('update', director)
  const reorderDirectors = names => request('reorder', { names })
  const deleteDirector = name => request('delete', { name })
  Object.assign(exports, { fetchDirectors, createDirector, updateDirector, reorderDirectors, deleteDirector })
  return exports
} })
