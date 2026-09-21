// 职责：持久化三种创作 Markdown 和唯一的系统 state.json，串行处理项目变更。
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from '../files.js'
import { projectsRoot } from '../paths.js'
import { stateValue, validEpisode, validJobId, validProjectId, validShotId } from '../schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(400, message)
const missing = error => { if (error.code === 'ENOENT') return ''; throw error }
const idNow = () => { const d = new Date(), p = (v, w = 2) => String(v).padStart(w, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}` }
const field = (markdown, key) => new RegExp(`^${key}: (.*)$`, 'm').exec(markdown)?.[1] || ''
const title = text => field(text, 'title')
const episodeCount = text => [...text.matchAll(/^### 第 \d+ 集 · /gm)].length
const shotIds = text => [...text.matchAll(/^### \[(S\d+)\] /gm)].map(item => item[1])
const initialState = now => ({ created_at: now, updated_at: now, auto: { task: null, paused: null, attempts: {} }, anchors: {}, episodes: {} })
const episodeState = state => ({ shots: {}, film_task: null, film: null, ...state })
const jobIds = state => [...new Set([...Object.values(state.anchors).flatMap(item => [item.image_job_id, item.source_job_id]),
  ...Object.values(state.episodes).flatMap(ep => [...Object.values(ep.shots || {}).flatMap(shot => [shot.job_id, shot.keyframe_job_id]), ep.film?.job_id, ep.film?.subtitle_job_id])].filter(validJobId))]

export function projectSummary(project) {
  const state = project.state, episodes = project.episodes || [], count = episodeCount(project.series_text || '')
  const shots = episodes.flatMap(item => item.shots || []), films = episodes.filter(item => item.film?.job_id).length
  const active = state.auto.task || shots.some(shot => ['pending', 'queued', 'running'].includes(shot.status) && shot.job_id)
  return { id: project.id, title: title(project.project_text), director: field(project.project_text, 'director'), genre: field(project.project_text, 'genre'),
    created_at: state.created_at, updated_at: project.updated_at, status: state.auto.paused ? 'paused' : films === count && count ? 'completed' : active ? 'active' : 'todo',
    cover_job_id: Object.values(state.anchors).find(item => item.source_job_id)?.source_job_id || null,
    lead: /### (.+)（主角）/.exec(project.series_text || '')?.[1] || '',
    episode_count: count, film_count: films, shot_count: shots.length, completed_count: shots.filter(item => item.status === 'succeeded').length,
    paused: state.auto.paused }
}

export function createProjectStore({ removeTasks = async () => {}, newId = idNow, directorExists = async () => true, ...unused } = {}) {
  const root = projectsRoot, changed = new Map()
  let queue = Promise.resolve()
  const enqueue = action => { const task = queue.then(action); queue = task.catch(() => {}); return task }
  const dir = id => { if (!validProjectId(id)) throw invalid('项目 ID 无效'); return join(root(), id) }
  const episodeDir = (id, number) => { if (!validEpisode(number)) throw invalid('集数无效'); return join(dir(id), 'episodes', String(number)) }
  const readText = path => readFile(path, 'utf8').catch(missing)
  async function atomic(path, value) {
    const temp = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temp, value, { mode: 0o600 }); await rename(temp, path) }
    finally { await rm(temp, { force: true }) }
  }
  const readState = async id => stateValue(JSON.parse(await readFile(join(dir(id), 'state.json'), 'utf8')))
  async function writeState(id, state) {
    state.updated_at = Math.max(Date.now(), (state.updated_at || 0) + 1)
    await atomic(join(dir(id), 'state.json'), JSON.stringify(state))
    changed.set(id, state.updated_at)
  }
  async function load(id) {
    const directory = dir(id)
    const [projectText, seriesText, state] = await Promise.all([readFile(join(directory, 'project.md'), 'utf8'), readText(join(directory, 'series.md')), readState(id)])
    const numbers = [...new Set([...Object.keys(state.episodes).map(Number), ...Array.from({ length: episodeCount(seriesText) }, (_, i) => i + 1)])]
      .filter(validEpisode).sort((a, b) => a - b)
    const episodes = await Promise.all(numbers.map(async number => {
      const script = await readText(join(episodeDir(id, number), 'script.md')), data = episodeState(state.episodes[number])
      return { number, script, shots: shotIds(script).map(shotId => ({ id: shotId, ...data.shots[shotId] })), film_task: data.film_task, film: data.film }
    }))
    const mtimes = await Promise.all([join(directory, 'project.md'), join(directory, 'series.md'), join(directory, 'state.json'),
      ...numbers.map(number => join(episodeDir(id, number), 'script.md'))].map(path => stat(path).then(item => item.mtimeMs, () => 0)))
    return { id, project_text: projectText, series_text: seriesText, state, episodes,
      updated_at: Math.max(...mtimes, changed.get(id) || 0) }
  }
  const read = id => enqueue(() => load(id))
  const readEpisode = (id, number) => enqueue(async () => {
    const project = await load(id)
    const episode = project.episodes.find(item => item.number === number) || { number, script: '', shots: [], film_task: null, film: null }
    return { ...project, episode: number, ...episode }
  })
  const list = () => enqueue(async () => {
    const entries = await readdir(root(), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))
    const items = []
    for (const entry of entries) if (entry.isDirectory() && validProjectId(entry.name) && entry.name !== '00000000') {
      try { items.push(projectSummary(await load(entry.name))) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return items.sort((a, b) => b.updated_at - a.updated_at)
  })
  const saveDoc = (id, kind, markdown, number) => enqueue(async () => {
    if (typeof markdown !== 'string' || markdown.length > 500000) throw invalid('文档内容无效')
    const path = kind === 'project' ? join(dir(id), 'project.md') : kind === 'series' ? join(dir(id), 'series.md')
      : kind === 'script' ? join(episodeDir(id, number), 'script.md') : null
    if (!path) throw invalid('文档类型无效')
    await readFile(join(dir(id), 'project.md'))
    if (kind === 'script') await mkdir(episodeDir(id, number), { recursive: true })
    await atomic(path, markdown)
    changed.set(id, Date.now())
    return load(id)
  })
  const changeState = (id, update) => enqueue(async () => {
    const state = await readState(id), next = stateValue(await update(state) || state)
    await writeState(id, next)
    return load(id)
  })
  const changeShot = (id, { episode, id: shotId, expect_job_id, expect_keyframe_job_id, ...patch }) => changeState(id, state => {
    if (!validEpisode(episode) || !validShotId(shotId)) throw invalid('镜头无效')
    const ep = state.episodes[episode] ||= episodeState()
    const shot = ep.shots[shotId] ||= { take: 0, keyframe_job_id: null, job_id: null, status: 'pending' }
    if (expect_job_id && shot.job_id !== expect_job_id || expect_keyframe_job_id && shot.keyframe_job_id !== expect_keyframe_job_id) return state
    ep.shots[shotId] = { ...shot, ...patch }
    return state
  })
  const changeAuto = (id, update) => changeState(id, state => { state.auto = update(state.auto); return state })
  const changeAnchor = (id, name, patch) => changeState(id, state => {
    state.anchors[name] = { ...state.anchors[name], ...patch }; return state
  })
  const requestEpisodeFilm = (id, number) => changeState(id, state => {
    const ep = state.episodes[number] ||= episodeState()
    const ids = Object.values(ep.shots).map(item => item.job_id)
    if (!ids.length || Object.values(ep.shots).some(item => item.status !== 'succeeded' || !validJobId(item.job_id))) throw statusError(409, '请先完成本集镜头')
    const taskId = createHash('sha256').update(JSON.stringify([id, number, ids])).digest('hex').slice(0, 32)
    if (ep.film?.job_id === taskId || ep.film_task?.task_id === taskId && ['pending', 'running'].includes(ep.film_task.status)) return state
    ep.film_task = { kind: 'film', task_id: taskId, project_id: id, episode: number, job_ids: ids, status: 'pending', created_at: Date.now() }
    return state
  })
  const updateEpisodeFilmTask = (id, number, taskId, patch) => changeState(id, state => {
    const task = state.episodes[number]?.film_task
    if (task?.task_id === taskId) state.episodes[number].film_task = { ...task, ...patch, updated_at: Date.now() }
    return state
  })
  const addEpisodeFilm = (id, number, ids, items) => changeState(id, state => {
    const ep = state.episodes[number] ||= episodeState()
    if (JSON.stringify(Object.values(ep.shots).map(item => item.job_id)) !== JSON.stringify(ids)) throw statusError(409, '镜头任务已变化')
    ep.film = { ...items.find(item => item.type === 'film'), subtitle_job_id: items.find(item => item.type === 'subtitle')?.job_id || null }
    return state
  })
  const lastModified = async id => (await read(id)).updated_at
  const change = (action, body) => enqueue(async () => {
    if (action === 'create') {
      if (!body?.title?.trim() || !body?.director || !await directorExists(body.director)) throw invalid('项目标题或导演无效')
      const now = Date.now(); let id = newId(); if (!validProjectId(id)) throw invalid('项目 ID 无效')
      await mkdir(root(), { recursive: true })
      for (;;) { try { await mkdir(join(root(), id)); break } catch (error) { if (error.code !== 'EEXIST') throw error; id = newId() } }
      await mkdir(join(dir(id), 'media'))
      await atomic(join(dir(id), 'media/manifest.json'), JSON.stringify({ version: 1, project_id: id, complete: false, files: [], missing: [] }))
      await atomic(join(dir(id), 'materials.json'), '[]')
      await atomic(join(dir(id), 'project.md'), `---\ntitle: ${body.title.trim()}\ndirector: ${body.director}\ngenre: ${body.genre || ''}\n---\n\n${body.synopsis || ''}\n`)
      await writeState(id, initialState(now))
      return load(id)
    }
    if (!validProjectId(body?.id)) throw invalid('项目 ID 无效')
    if (action === 'delete') {
      await removeTasks(body.id); await rm(dir(body.id), { recursive: true, force: true }); changed.delete(body.id); return { deleted: true }
    }
    if (action === 'update') {
      const path = join(dir(body.id), 'project.md'), old = await readFile(path, 'utf8')
      const next = Object.entries({ title: body.title, director: body.director, genre: body.genre }).reduce((text, [key, val]) => val === undefined ? text : text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${val}`), old)
      const synopsis = body.synopsis === undefined ? next : next.replace(/(\n---\n)[\s\S]*$/, `$1\n${body.synopsis}\n`)
      await atomic(path, synopsis); changed.set(body.id, Date.now()); return load(body.id)
    }
    throw invalid('项目操作无效')
  })
  return { read, readEpisode, list, saveDoc, changeState, changeShot, changeAuto, changeAnchor, requestEpisodeFilm,
    updateEpisodeFilmTask, addEpisodeFilm, lastModified, change }
}
