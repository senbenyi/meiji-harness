// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from '../files.js'
import { join } from 'node:path'
import { projectsRoot } from '../paths.js'
import { anchorsValue, actsValue, deliverablesValue, directorValue, materialsValue, serverUrl, shotValue, storyValue, titleValue, validJobId, validProjectId, validShotId } from '../schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const FREE_PROJECT_ID = '00000000'
const invalidRequest = message => statusError(400, message)
const unavailableJob = async () => { throw new Error('项目素材校验服务未配置') }
const timeProjectId = () => {
  const now = new Date(), part = (value, width = 2) => String(value).padStart(width, '0')
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}${part(now.getMilliseconds(), 3)}`
}

export function episodeReviewIssue(project, planning, episode, shots) {
  if (!planning.series.finalized) return null
  const entry = planning.episodes[String(episode)]
  if (!entry?.timeline?.finalized || entry.timeline.needs_review) return '本集时间线需复核'
  if (!entry.storyboard?.finalized || entry.storyboard.needs_review) return '本集分镜需复核'
  for (const shot of shots) {
    const prompt = entry.prompts?.[shot.id]
    if (prompt?.needs_review) return `镜头 ${shot.id} 提示词需复核`
    for (const role of [...(shot.roles || []), `scene-${shot.scene}`]) {
      const anchor = project.anchors.find(item => item.role === role)
      if (!anchor || anchor.retired) return `镜头 ${shot.id} 引用的锚点 ${role} 已失效`
    }
  }
  return null
}

export function projectSummary(value) {
  const episodes = value.episodes || []
  const shots = (episodes.length ? episodes.flatMap(episode => episode.acts) : value.acts).flatMap(act => act.shots)
  const deliverables = episodes.length ? episodes.flatMap(episode => episode.deliverables) : value.deliverables
  const active = shots.some(shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && shot.job_id)
  const completed = value.planning_episode_count
    ? Array.from({ length: value.planning_episode_count }, (_, index) => value.episodes?.find(item => item.number === index + 1)?.deliverables.some(item => item.type === 'film')).every(Boolean)
    : deliverables.length > 0 && shots.every(shot => shot.status === 'succeeded')
  const stage = shots.length ? 'episodes' : !value.anchors.length ? 'project' : 'anchors'
  return {
    cover_job_id: value.cover_job_id || (value.anchors.some(anchor => serverUrl(anchor.image_url)) ? null : value.anchors.find(anchor => anchor.source?.job_id)?.source.job_id || null),
    cover_url: value.cover_job_id ? null : value.anchors.find(anchor => serverUrl(anchor.image_url))?.image_url || null,
    id: value.id, title: value.title, director: value.director || null, created_at: value.created_at, updated_at: value.updated_at,
    status: active ? 'active' : completed ? 'completed' : 'todo', stage,
    anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length,
    deliverable_count: deliverables.length, episode_count: episodes.length,
  }
}

export function createProjectStore({ readJob = unavailableJob, summarizeJob = unavailableJob, removeTasks = async () => {}, newId = timeProjectId, directorExists = async () => true } = {}) {
  const root = projectsRoot
  const names = { materials: 'materials.json', anchors: 'anchors.json', acts: 'storyboard.json', deliverables: 'deliverables.json' }
  const metadataOf = ({ materials, anchors, acts, deliverables, episodes, episode, film_task, planning_episode_count, ...metadata }) => metadata
  const materialIdsOf = value => [...new Set([...(value.materials || []), value.cover_job_id,
    ...(value.deliverables || []).map(item => item.job_id), ...(value.episodes || []).flatMap(episode => episode.deliverables.map(item => item.job_id)),
    ...value.anchors.map(anchor => anchor.source?.job_id), ...value.acts.flatMap(act => act.shots.map(shot => shot.job_id)),
    ...(value.episodes || []).flatMap(episode => episode.acts.flatMap(act => act.shots.map(shot => shot.job_id)))].filter(validJobId))]
  const modifiedAt = new Map()
  let operations = Promise.resolve()

  async function writeJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }) }
  }

  async function writeProject(directory, value, sections) {
    await Promise.all([...new Set(sections)].map(key => writeJson(join(directory, names[key]), value[key])))
    await writeJson(join(directory, 'project.json'), metadataOf(value))
    modifiedAt.set(value.id, value.updated_at)
  }

  // 为旧镜头补稳定身份，排序和后续读取不改变已有 ID。
  function ensureShotIds(acts) {
    const ids = new Set(acts.flatMap(act => act.shots.map(shot => shot.id)).filter(Boolean))
    let changed = false
    for (const act of acts) for (const shot of act.shots) {
      if (shot.id !== undefined) continue
      let id
      do { id = randomBytes(4).toString('hex') } while (ids.has(id))
      shot.id = id; ids.add(id); changed = true
    }
    return changed
  }

  async function loadEpisodes(id) {
    const directory = join(root(), id, 'episodes')
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const episodes = []
    for (const entry of entries) {
      const number = Number(entry.name)
      if (!entry.isDirectory() || !Number.isInteger(number) || number < 1 || number > 100) continue
      const acts = await readFile(join(directory, entry.name, 'storyboard.json'), 'utf8').then(JSON.parse, error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const deliverables = await readFile(join(directory, entry.name, 'deliverables.json'), 'utf8').then(JSON.parse, error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      episodes.push({ number, acts, deliverables })
    }
    return episodes.sort((a, b) => a.number - b.number)
  }

  async function planningEpisodeCount(id) {
    const planning = await readFile(join(root(), id, 'planning.json'), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    const series = planning?.series?.versions.find(item => item.version === planning.series.finalized)?.value
    return series?.episode_count || null
  }

  async function load(id) {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    const directory = join(root(), id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    if (['anchors', 'acts', 'deliverables'].some(key => Object.hasOwn(metadata, key))) {
      const value = { ...metadata, materials: metadata.materials || [], anchors: metadata.anchors || [], acts: metadata.acts || [], deliverables: metadata.deliverables || [] }
      ensureShotIds(value.acts)
      value.materials = materialIdsOf(value)
      await writeProject(directory, value, ['materials', 'anchors', 'acts', 'deliverables'])
      const episodes = await loadEpisodes(id)
      const count = await planningEpisodeCount(id)
      return { ...value, ...(episodes.length ? { episodes } : {}), ...(count ? { planning_episode_count: count } : {}) }
    }
    const [anchors, acts, deliverables] = await Promise.all(['anchors', 'acts', 'deliverables'].map(key => readFile(join(directory, names[key]), 'utf8').then(JSON.parse)))
    let materials
    try { materials = JSON.parse(await readFile(join(directory, names.materials), 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      materials = materialIdsOf({ ...metadata, materials: [], anchors, acts })
      await writeJson(join(directory, names.materials), materials)
    }
    if (ensureShotIds(acts)) await writeJson(join(directory, names.acts), acts)
    const episodes = await loadEpisodes(id)
    const count = await planningEpisodeCount(id)
    return { ...metadata, materials, anchors, acts, deliverables, ...(episodes.length ? { episodes } : {}), ...(count ? { planning_episode_count: count } : {}) }
  }

  function enqueue(action) {
    const operation = operations.then(action)
    operations = operation.catch(() => {})
    return operation
  }

  const read = id => enqueue(() => load(id))

  const episodePath = (id, episode) => {
    if (!validProjectId(id) || !Number.isInteger(episode) || episode < 1 || episode > 100) throw invalidRequest('项目或集数无效')
    return join(root(), id, 'episodes', String(episode), 'storyboard.json')
  }
  async function loadEpisode(id, episode) {
    const project = await load(id)
    let legacy = false
    const acts = await readFile(episodePath(id, episode), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') { legacy = episode === 1; return legacy ? project.acts : [] }
      throw error
    })
    const deliverables = await readFile(join(root(), id, 'episodes', String(episode), 'deliverables.json'), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return legacy ? project.deliverables : []
      throw error
    })
    const filmTask = await readFile(join(root(), id, 'episodes', String(episode), 'film-task.json'), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return { ...project, episode, acts, deliverables, film_task: filmTask }
  }
  const readEpisode = (id, episode) => enqueue(() => loadEpisode(id, episode))
  const saveEpisodeStoryboard = (id, episode, acts) => enqueue(async () => {
    const project = await load(id), path = episodePath(id, episode)
    await mkdir(join(root(), id, 'episodes', String(episode)), { recursive: true })
    const value = actsValue(acts)
    ensureShotIds(value)
    await writeJson(path, value)
    project.updated_at = Math.max(Date.now(), project.updated_at + 1)
    await writeJson(join(root(), id, 'project.json'), metadataOf(project))
    modifiedAt.set(id, project.updated_at)
    return { ...project, episode, acts: value }
  })
  const addEpisodeFilm = (id, episode, jobIds, film) => enqueue(async () => {
    const value = await loadEpisode(id, episode), shots = value.acts.flatMap(act => act.shots)
    if (!shots.length || shots.length !== jobIds.length || shots.some((shot, index) => shot.status !== 'succeeded' || !shot.accepted || shot.job_id !== jobIds[index])) throw statusError(409, '剧集分镜已变化或镜头未采用，请重新制作成片')
    if (value.deliverables.some(item => item.job_id === film.job_id)) return value
    value.deliverables = deliverablesValue([...value.deliverables, film])
    value.episodes = [...(value.episodes || []).filter(item => item.number !== episode), { number: episode, acts: value.acts, deliverables: value.deliverables }]
    value.materials = materialIdsOf(value)
    await mkdir(join(root(), id, 'episodes', String(episode)), { recursive: true })
    await writeJson(join(root(), id, 'episodes', String(episode), 'deliverables.json'), value.deliverables)
    await writeJson(join(root(), id, names.materials), value.materials)
    value.updated_at = Math.max(Date.now(), value.updated_at + 1)
    await writeJson(join(root(), id, 'project.json'), metadataOf(value))
    modifiedAt.set(id, value.updated_at)
    return value
  })
  const requestEpisodeFilm = (id, episode) => enqueue(async () => {
    const value = await loadEpisode(id, episode), shots = value.acts.flatMap(act => act.shots)
    if (!shots.length || shots.some(shot => shot.status !== 'succeeded' || !shot.accepted || !validJobId(shot.job_id))) throw statusError(409, '请先完成并采用本集全部镜头')
    const issue = episodeReviewIssue(value, await loadPlanning(id), episode, shots)
    if (issue) throw statusError(409, issue)
    const jobIds = shots.map(shot => shot.job_id)
    const taskId = createHash('sha256').update(JSON.stringify([id, episode, jobIds])).digest('hex').slice(0, 32)
    if (value.film_task?.task_id === taskId && ['pending', 'running'].includes(value.film_task.status)) return value
    if (value.film_task?.status === 'running') throw statusError(409, '本集合成任务正在执行')
    if (value.film_task?.task_id === taskId && value.film_task.status === 'succeeded' && value.deliverables.some(item => item.job_id === taskId)) return value
    const task = { kind: 'film', task_id: taskId, project_id: id, episode, job_ids: jobIds, status: 'pending', created_at: Date.now() }
    await mkdir(join(root(), id, 'episodes', String(episode)), { recursive: true })
    await writeJson(join(root(), id, 'episodes', String(episode), 'film-task.json'), task)
    value.updated_at = Math.max(Date.now(), value.updated_at + 1)
    await writeJson(join(root(), id, 'project.json'), metadataOf(value))
    modifiedAt.set(id, value.updated_at)
    return { ...value, film_task: task }
  })
  const updateEpisodeFilmTask = (id, episode, taskId, patch) => enqueue(async () => {
    const value = await loadEpisode(id, episode)
    if (value.film_task?.task_id !== taskId) return value
    const task = { ...value.film_task, ...patch, updated_at: Date.now() }
    await writeJson(join(root(), id, 'episodes', String(episode), 'film-task.json'), task)
    value.updated_at = Math.max(Date.now(), value.updated_at + 1)
    await writeJson(join(root(), id, 'project.json'), metadataOf(value))
    modifiedAt.set(id, value.updated_at)
    return { ...value, film_task: task }
  })

  const planningPath = id => join(root(), id, 'planning.json')
  async function loadPlanning(id) {
    await load(id)
    return readFile(planningPath(id), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return { series: { versions: [], finalized: null }, episodes: {} }
      throw error
    })
  }
  const planningEntry = (planning, step, episode, shotId) => {
    if (step === 'series') return planning.series
    const episodeKey = String(episode)
    planning.episodes[episodeKey] ||= {}
    if (step === 'shot-prompt') {
      planning.episodes[episodeKey].prompts ||= {}
      return planning.episodes[episodeKey].prompts[shotId] ||= { versions: [], finalized: null }
    }
    return planning.episodes[episodeKey][step] ||= { versions: [], finalized: null }
  }
  const readPlanning = id => enqueue(() => loadPlanning(id))
  const appendPlanningVersion = (id, step, episode, shotId, value, request = '', basedOn = {}) => enqueue(async () => {
    const planning = await loadPlanning(id), entry = planningEntry(planning, step, episode, shotId)
    entry.versions.push({ version: entry.versions.length + 1, value, request, based_on: basedOn, created_at: Date.now() })
    if (step === 'timeline') {
      const next = planning.episodes[String(episode + 1)]?.timeline
      if (next?.versions.length) next.needs_review = true
    }
    await writeJson(planningPath(id), planning)
    return planning
  })
  const finalizePlanningVersion = (id, step, episode, shotId, version, valueOverride) => enqueue(async () => {
    const planning = await loadPlanning(id), entry = planningEntry(planning, step, episode, shotId)
    const selected = entry.versions.find(item => item.version === version)
    if (!selected) throw invalidRequest('规划版本不存在')
    const current = step === 'series' ? {} : step === 'timeline' ? {
      series: planning.series.finalized,
      previous_timeline: planning.episodes[String(episode - 1)]?.timeline?.versions.at(-1)?.version ?? null,
    } : step === 'storyboard' ? { timeline: planning.episodes[episode]?.timeline?.finalized ?? null }
      : { storyboard: planning.episodes[episode]?.storyboard?.finalized ?? null }
    if (JSON.stringify(selected.based_on || {}) !== JSON.stringify(current)) throw statusError(409, '规划依据已变化，请先复核上游并重新生成')
    if (valueOverride) selected.value = valueOverride
    if (entry.finalized !== version) {
      entry.finalized = version
      const later = step === 'series' ? Object.values(planning.episodes).flatMap(item => [item.timeline, item.storyboard, ...Object.values(item.prompts || {})])
        : step === 'timeline' ? [planning.episodes[episode]?.storyboard, ...Object.values(planning.episodes[episode]?.prompts || {})]
          : step === 'storyboard' ? Object.values(planning.episodes[episode]?.prompts || {}) : []
      for (const item of later) if (item?.finalized) item.needs_review = true
      entry.needs_review = false
      if (step === 'series') for (const [number, item] of Object.entries(planning.episodes)) item.retired = Number(number) > selected.value.episode_count
    }
    await writeJson(planningPath(id), planning)
    return planning
  })

  const addFilm = (id, jobIds, film) => enqueue(async () => {
    const value = await load(id)
    const shots = value.acts.flatMap(act => act.shots)
    if (!shots.length || shots.length !== jobIds.length || shots.some((shot, index) => shot.status !== 'succeeded' || shot.job_id !== jobIds[index])) throw statusError(409, '分镜已变化，请重新制作成片')
    if (value.deliverables.some(item => item.job_id === film.job_id)) return value
    value.deliverables = deliverablesValue([...value.deliverables, film])
    value.materials = materialIdsOf(value)
    value.updated_at = Math.max(Date.now(), value.updated_at + 1)
    await writeProject(join(root(), id), value, ['deliverables', 'materials'])
    return value
  })

  async function checkedDirector(value) {
    const name = directorValue(value)
    if (!await directorExists(name)) throw invalidRequest('导演 Skill 不存在')
    return name
  }

  // 封面只能引用已完成且仍可读取的图片素材。
  async function checkedCover(jobId) {
    if (!validJobId(jobId)) throw invalidRequest('封面素材 ID 无效')
    const summary = await summarizeJob(await readJob(jobId))
    if (!summary.has_image) throw invalidRequest('封面只能使用可用的图片素材')
    return jobId
  }

  const list = () => enqueue(async () => {
    const entries = await readdir(root(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validProjectId(entry.name)) continue
      try {
        const value = await load(entry.name)
        if (value.internal === 'free') continue
        items.push(projectSummary(value))
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return items.sort((a, b) => b.updated_at - a.updated_at)
  })

  async function change(action, body) {
    if (action !== 'create' && !validProjectId(body.id)) throw invalidRequest('项目 ID 无效')
    return enqueue(async () => {
      if (action === 'delete') {
        await readFile(join(root(), body.id, 'project.json'))
        await removeTasks(body.id)
        await rm(join(root(), body.id), { recursive: true, force: true })
        modifiedAt.delete(body.id)
        return { deleted: true }
      }
      let value, sections
      if (action === 'create') {
        const now = Date.now()
        do { value = { id: newId() } } while (value.id === FREE_PROJECT_ID)
        value = { ...value, title: titleValue(body.title), director: await checkedDirector(body.director),
          genre: storyValue(body.genre ?? '', '题材', 200), synopsis: storyValue(body.synopsis ?? '', '梗概'),
          created_at: now, updated_at: now, materials: [], anchors: [], acts: [], deliverables: [] }
        if (body.cover_job_id === undefined) throw invalidRequest('创建项目请先选择封面图片')
        value.cover_job_id = await checkedCover(body.cover_job_id)
        value.materials = [value.cover_job_id]
        sections = ['materials', 'anchors', 'acts', 'deliverables']
        await mkdir(root(), { recursive: true })
        for (;;) {
          try { await mkdir(join(root(), value.id)); break }
          catch (error) { if (error.code !== 'EEXIST') throw error; value.id = newId() }
        }
        await Promise.all(['production', 'media'].map(name => mkdir(join(root(), value.id, name))))
        await writeJson(join(root(), value.id, 'media', 'manifest.json'), { version: 1, project_id: value.id, complete: false, files: [], missing: [] })
      } else {
        value = await load(body.id)
        sections = []
        if (body.cover_job_id !== undefined && body.cover_job_id !== value.cover_job_id) value.cover_job_id = await checkedCover(body.cover_job_id)
        if (body.title !== undefined) value.title = titleValue(body.title)
        if (body.genre !== undefined) value.genre = storyValue(body.genre, '题材', 200)
        if (body.synopsis !== undefined) value.synopsis = storyValue(body.synopsis, '梗概')
        if (body.director !== undefined && body.director !== value.director) {
          value.director = await checkedDirector(body.director)
          const planning = await loadPlanning(body.id)
          let changed = false
          for (const entry of [planning.series, ...Object.values(planning.episodes).flatMap(item => [item.timeline, item.storyboard, ...Object.values(item.prompts || {})])]) {
            if (entry?.finalized) { entry.needs_review = true; changed = true }
          }
          if (changed) await writeJson(planningPath(body.id), planning)
        }
        if (body.materials !== undefined) { value.materials = materialsValue(body.materials); sections.push('materials') }
        if (body.anchors !== undefined) { value.anchors = anchorsValue(body.anchors); sections.push('anchors') }
        if (body.acts !== undefined) { value.acts = actsValue(body.acts); ensureShotIds(value.acts); sections.push('acts') }
        if (body.deliverables !== undefined) { value.deliverables = deliverablesValue(body.deliverables); sections.push('deliverables') }
        if (action === 'import') {
          if (body.as !== 'anchor' || !validJobId(body.job_id)) throw invalidRequest('素材引入参数无效')
          const job = await readJob(body.job_id), summary = await summarizeJob(job)
          if (!summary.has_image || !job.result.local_media_path && !serverUrl(job.result.comfyui_view_url)) throw invalidRequest('锚点只能使用可用的图片素材')
          const role = body.role || `material-${body.job_id}`
          const previous = value.anchors.find(anchor => anchor.role === role)
          const anchor = { role, label: previous?.label || '素材锚点', description: previous?.description || '', source: { type: 'material', job_id: body.job_id }, image_url: summary.has_image && !job.result.local_media_path ? job.result.comfyui_view_url : '' }
          value.anchors = anchorsValue(previous ? value.anchors.map(item => item.role === role ? anchor : item) : [...value.anchors, anchor])
          sections.push('anchors')
        }
        const materials = materialIdsOf(value)
        if (materials.some((id, index) => id !== value.materials[index]) || materials.length !== value.materials.length) { value.materials = materials; sections.push('materials') }
        value.updated_at = Math.max(Date.now(), value.updated_at + 1)
      }
      await writeProject(join(root(), value.id), value, sections)
      return value
    })
  }

  // 在同一队列中读取最新值、修改单个对象并持久化，避免旧数组覆盖其他对象。
  function changeObject(id, mutate, episode) {
    return enqueue(async () => {
      const value = episode === undefined ? await load(id) : await loadEpisode(id, episode)
      const sections = mutate(value)
      if (sections === null) return value
      value.anchors = anchorsValue(value.anchors)
      value.acts = actsValue(value.acts)
      if (episode !== undefined) {
        value.episodes = [...(value.episodes || []).filter(item => item.number !== episode), { number: episode, acts: value.acts, deliverables: value.deliverables }]
        value.materials = materialIdsOf(value)
        value.updated_at = Math.max(Date.now(), value.updated_at + 1)
        await mkdir(join(root(), id, 'episodes', String(episode)), { recursive: true })
        await writeJson(episodePath(id, episode), value.acts)
        await writeJson(join(root(), id, names.materials), value.materials)
        await writeJson(join(root(), id, 'project.json'), metadataOf(value))
        modifiedAt.set(id, value.updated_at)
        return value
      }
      const materials = materialIdsOf(value)
      if (materials.length !== value.materials.length || materials.some((item, i) => item !== value.materials[i])) {
        value.materials = materials; sections.push('materials')
      }
      value.updated_at = Math.max(Date.now(), value.updated_at + 1)
      await writeProject(join(root(), id), value, sections)
      return value
    })
  }

  const changeAnchor = (id, action, data) => changeObject(id, value => {
    if (!['add', 'update', 'delete'].includes(action)) throw invalidRequest('锚点操作无效')
    const index = value.anchors.findIndex(anchor => anchor.role === data.role)
    if (action === 'add') value.anchors.push({ label: '', description: '', source: null, image_url: '', ...data })
    else {
      if (index < 0) throw invalidRequest('锚点不存在')
      if (action === 'delete') value.anchors.splice(index, 1)
      else {
        const { new_role, ...patch } = data
        value.anchors[index] = { ...value.anchors[index], ...patch, role: new_role ?? data.role }
        if (new_role !== undefined && new_role !== data.role) {
          for (const act of value.acts) for (const shot of act.shots) if (shot.role === data.role) shot.role = new_role
          return ['anchors', 'acts']
        }
      }
    }
    return ['anchors']
  })

  const changeAct = (id, action, data) => changeObject(id, value => {
    if (!['add', 'update', 'delete', 'move'].includes(action)) throw invalidRequest('幕操作无效')
    if (action === 'add') value.acts.push({ title: data.title, shots: [] })
    else {
      if (!Number.isInteger(data.act_index) || !value.acts[data.act_index]) throw invalidRequest('幕不存在')
      if (action === 'update') value.acts[data.act_index].title = data.title
      if (action === 'delete') value.acts.splice(data.act_index, 1)
      if (action === 'move') {
        if (![1, -1].includes(data.direction) || !value.acts[data.act_index + data.direction]) throw invalidRequest('移动方向无效或已到幕边界')
        const target = data.act_index + data.direction
        ;[value.acts[data.act_index], value.acts[target]] = [value.acts[target], value.acts[data.act_index]]
      }
    }
    return ['acts']
  }, data.episode)

  const changeShot = (id, action, data) => changeObject(id, value => {
    if (!['add', 'update', 'delete', 'move', 'accept'].includes(action)) throw invalidRequest('镜头操作无效')
    if (action === 'add') {
      if (!Number.isInteger(data.act_index) || !value.acts[data.act_index]) throw invalidRequest('幕不存在')
      value.acts[data.act_index].shots.push(shotValue({ role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '', ...data, id: undefined }))
      ensureShotIds(value.acts)
    } else {
      if (!validShotId(data.id)) throw invalidRequest('镜头 ID 无效')
      const act = value.acts.find(act => act.shots.some(shot => shot.id === data.id))
      if (action === 'update' && Object.hasOwn(data, 'expect_job_id') &&
        (!act || act.shots.find(shot => shot.id === data.id).job_id !== data.expect_job_id)) return null
      if (!act) throw invalidRequest('镜头不存在')
      const index = act.shots.findIndex(shot => shot.id === data.id)
      if (action === 'update') {
        const { expect_job_id, ...patch } = data
        const previous = act.shots[index]
        act.shots[index] = { ...previous, ...patch,
          accepted: patch.job_id !== undefined && patch.job_id !== previous.job_id || patch.status !== undefined && patch.status !== previous.status ? false : previous.accepted || false }
      }
      if (action === 'accept') {
        if (typeof data.accepted !== 'boolean') throw invalidRequest('镜头采用参数无效')
        if (data.accepted && act.shots[index].status !== 'succeeded') throw statusError(409, '只有已完成镜头可以采用')
        act.shots[index].accepted = data.accepted
      }
      if (action === 'delete') act.shots.splice(index, 1)
      if (action === 'move') {
        if (![1, -1].includes(data.direction) || !act.shots[index + data.direction]) throw invalidRequest('移动方向无效或已到幕边界')
        const target = index + data.direction
        ;[act.shots[index], act.shots[target]] = [act.shots[target], act.shots[index]]
      }
    }
    return ['acts']
  }, data.episode)

  // 冷启动从持久化元数据恢复标记，后续轮询复用本实例的成功写入记录。
  const lastModified = id => enqueue(async () => {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    if (!modifiedAt.has(id)) {
      const value = JSON.parse(await readFile(join(root(), id, 'project.json'), 'utf8'))
      modifiedAt.set(id, value.updated_at)
    }
    return modifiedAt.get(id)
  })

  const usesDirector = name => enqueue(async () => {
    const entries = await readdir(root(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const entry of entries) {
      if (!entry.isDirectory() || !validProjectId(entry.name)) continue
      try {
        const metadata = JSON.parse(await readFile(join(root(), entry.name, 'project.json'), 'utf8'))
        if (metadata.director === name) return true
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return false
  })

  return { list, read, readEpisode, saveEpisodeStoryboard, addEpisodeFilm, requestEpisodeFilm, updateEpisodeFilmTask,
    change, changeAnchor, changeAct, changeShot, addFilm, lastModified, usesDirector,
    readPlanning, appendPlanningVersion, finalizePlanningVersion }
}
