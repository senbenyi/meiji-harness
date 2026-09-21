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
  const fetchEpisode = (id, episode) => request('episode', null, { id, number: episode })
  const createProject = ({ title, director, genre, synopsis }) => request('create', { title, director, genre, synopsis })
  const suggestProject = director => request('project-suggest', { director })
  const updateProject = (id, patch) => request('update', { ...patch, id })
  const deleteProject = id => request('delete', { id })
  const replaceAnchorImage = (id, role, jobId) => request('import', { id, as: 'anchor', role, job_id: jobId })
  const generateAnchorImage = (projectId, role) => request('anchor-generate', { project_id: projectId, role })
  const confirmAnchors = id => request('anchors-confirm', { id })
  const readPlanning = id => request('plan-read', { id })
  const generatePlanning = (id, step, episode, shot_id, requirements = '') => request('plan-generate', { id, step, episode, shot_id, request: requirements })
  const editPlanning = (id, step, episode, shot_id, value) => request('plan-edit', { id, step, episode, shot_id, value })
  const finalizePlanning = (id, step, episode, shot_id, version) => request('plan-finalize', { id, step, episode, shot_id, version })
  const reshootShot = (projectId, episode, shotId) => request('reshoot', { project_id: projectId, episode, shot_id: shotId })
  const retryShot = (projectId, episode, shotId) => request('retry', { project_id: projectId, episode, shot_id: shotId })
  const startAuto = (id, untilEpisode = null) => request('auto-start', { id, until_episode: untilEpisode })
  const pauseAuto = id => request('auto-pause', { id })
  const resumeAuto = id => request('auto-resume', { id })
  const pollProject = (id, since) => request('poll', null, { id, since })
  Object.assign(exports, { fetchProjects, fetchProject, fetchEpisode, createProject, suggestProject, updateProject, deleteProject, replaceAnchorImage, generateAnchorImage, confirmAnchors,
    readPlanning, generatePlanning, editPlanning, finalizePlanning, reshootShot, retryShot, startAuto, pauseAuto, resumeAuto, pollProject })
  return exports
} })
