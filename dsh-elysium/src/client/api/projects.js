// 职责：调用项目 HTTP 端点，不包含视图状态。
window.__ModuleLoader__.load({ id: 'elysium/project-api', factory: require => {
  const exports = {}
  function projectUrl(action, params = {}) {
    const config = window.__ELYSIUM_MEDIA__
    if (!config?.token || !config.projectBase) throw new Error('项目服务未加载，请刷新页面或检查服务')
    const query = new URLSearchParams(params)
    query.set('t', config.token)
    return `${config.projectBase}/${action}?${query}`
  }
  async function request(action, body, params = {}) {
    const response = await fetch(projectUrl(action, params), { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '项目操作失败')
    return value
  }
  const fetchProjects = () => request('list')
  const fetchProject = id => request('get', null, { id })
  const createProject = payload => request('create', payload)
  const updateProject = (id, patch) => request('update', { ...patch, id })
  const deleteProject = id => request('delete', { id })
  const importMaterial = (id, jobId, as = 'anchor', role) => request('import', { id, job_id: jobId, as, ...(role ? { role } : {}) })
  const updateAnchor = (id, action, data) => request('update-anchor', { id, action, data })
  const updateShot = (id, action, data) => request('update-shot', { id, action, data })
  const pollProject = (id, since) => request('poll', null, { id, since })
  const workflowAction = (id, action, body = {}) => request('workflow', { ...body, id, action })
  Object.assign(exports, { workflowAction, fetchProjects, fetchProject, createProject, updateProject, deleteProject, importMaterial, updateAnchor, updateShot, pollProject })
  return exports
} })
