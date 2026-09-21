// 职责：调用项目文档、定妆与生产 HTTP 端点，不保存视图状态。
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
    const response = await fetch(projectUrl(action, params), { credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '项目操作失败')
    return value
  }
  const downloadFilmsUrl = id => projectUrl('films-download', { id })
  const fetchProjects = () => request('list')
  const fetchProject = id => request('get', null, { id })
  const fetchEpisode = (id, number) => request('episode', null, { id, number })
  const createProject = body => request('create', body)
  const updateProject = (id, patch) => request('update', { id, ...patch })
  const deleteProject = id => request('delete', { id })
  const readDoc = (id, step, episode) => request('doc-read', null, { id, step, ...(episode ? { episode } : {}) })
  const saveDoc = (id, step, markdown, episode) => request('doc-save', { id, step, markdown, ...(episode ? { episode } : {}) })
  const generateDoc = (id, step, episode, shotId, director) => request('doc-generate', { ...(id ? { id } : {}), step,
    ...(episode ? { episode } : {}), ...(shotId ? { shot_id: shotId } : {}), ...(director ? { director } : {}) })
  const generateAnchorImage = (id, role) => request('anchor-generate', { project_id: id, role })
  const replaceAnchorImage = (id, role, jobId) => request('anchor-import', { id, role, job_id: jobId })
  const startFill = id => request('auto-fill', { id })
  const startProduce = id => request('auto-produce', { id })
  const pauseAuto = id => request('auto-pause', { id })
  const reshootShot = (id, episode, shotId) => request('reshoot', { project_id: id, episode, shot_id: shotId })
  const previewShot = (id, episode, shotId) => request('shot-preview', { id, episode, shot_id: shotId })
  const composeFilm = (id, episode) => request('film-compose', { id, episode })
  const produceEpisode = (id, episode) => request('produce-episode', { id, episode })
  const pollProject = (id, since) => request('poll', null, { id, since })
  Object.assign(exports, { downloadFilmsUrl, fetchProjects, fetchProject, fetchEpisode, createProject, updateProject, deleteProject, readDoc, saveDoc, generateDoc,
    generateAnchorImage, replaceAnchorImage, startFill, startProduce, pauseAuto, reshootShot, previewShot, composeFilm, produceEpisode, pollProject })
  return exports
} })
