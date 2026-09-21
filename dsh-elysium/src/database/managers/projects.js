// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from '../files.js'
import { join } from 'node:path'
import { projectsRoot } from '../paths.js'
import { anchorsValue, actsValue, autoValue, deliverablesValue, directorValue, storyValue, titleValue, validEpisode, validJobId, validProjectId, validShotId } from '../schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const FREE_PROJECT_ID = '00000000'
const invalidRequest = message => statusError(400, message)
const unavailableJob = async () => { throw new Error('项目素材校验服务未配置') }
const timeProjectId = () => {
  const now = new Date(), part = (value, width = 2) => String(value).padStart(width, '0')
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}${part(now.getMilliseconds(), 3)}`
}
const running = shot => ['queued', 'running'].includes(shot.status) || shot.status === 'pending' && Boolean(shot.job_id)
export const shotsOf = episode => episode.acts.flatMap(act => act.shots)

// 某步骤版本生成时依赖的上游定稿；与当前不一致的版本不能定稿。
export const planningBasis = (planning, step, episode) => step === 'series' ? {} : step === 'timeline' ? {
  series: planning.series.finalized,
  previous_timeline: planning.episodes[String(episode - 1)]?.timeline?.versions.at(-1)?.version ?? null,
} : step === 'storyboard' ? { timeline: planning.episodes[episode]?.timeline?.finalized ?? null }
  : { storyboard: planning.episodes[episode]?.storyboard?.finalized ?? null }

export function episodeReviewIssue(project, planning, episode, shots) {
  const entry = planning.episodes[String(episode)]
  if (!planning.series.finalized) return '请先定稿剧情总览'
  if (!entry?.timeline?.finalized || entry.timeline.needs_review) return '本集时间线需复核'
  if (!entry.storyboard?.finalized || entry.storyboard.needs_review) return '本集分镜需复核'
  for (const shot of shots) {
    if (entry.prompts?.[shot.id]?.needs_review) return `镜头 ${shot.id} 提示词需复核`
    for (const role of [...shot.roles, `scene-${shot.scene}`]) {
      const anchor = project.anchors.find(item => item.role === role)
      if (!anchor || anchor.retired) return `镜头 ${shot.id} 引用的锚点 ${role} 已失效`
    }
  }
  return null
}

export function projectSummary(value) {
  const shots = value.episodes.flatMap(shotsOf), films = value.episodes.filter(episode => episode.deliverables.some(item => item.type === 'film'))
  const active = shots.some(running) || value.episodes.some(episode => ['pending', 'running'].includes(episode.film_task?.status))
  const count = value.planning_episode_count || 0
  const completed = count > 0 && Array.from({ length: count }, (_, index) => films.some(episode => episode.number === index + 1)).every(Boolean)
  return {
    cover_job_id: value.cover_job_id || value.anchors.find(anchor => anchor.kind === 'character' && anchor.source?.job_id)?.source.job_id || null,
    id: value.id, title: value.title, director: value.director || null, created_at: value.created_at, updated_at: value.updated_at,
    status: active || value.auto.enabled && !value.auto.paused && !completed ? 'active' : completed ? 'completed' : 'todo',
    anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length,
    episode_count: count, film_count: films.length,
  }
}

export function createProjectStore({ readJob = unavailableJob, summarizeJob = unavailableJob, removeTasks = async () => {}, newId = timeProjectId, directorExists = async () => true } = {}) {
  const root = projectsRoot
  const metadataOf = ({ materials, anchors, episodes, episode, acts, deliverables, film_task, planning_episode_count, auto, ...metadata }) => metadata
  const materialIdsOf = value => [...new Set([...value.materials, value.cover_job_id, ...value.anchors.map(anchor => anchor.source?.job_id),
    ...value.episodes.flatMap(episode => [...episode.deliverables.map(item => item.job_id), ...shotsOf(episode).flatMap(shot => [shot.job_id, shot.keyframe_job_id])])].filter(validJobId))]
  const modifiedAt = new Map()
  let operations = Promise.resolve()

  async function writeJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }) }
  }
  const readOptional = (path, fallback) => readFile(path, 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
  const episodeDirectory = (id, episode) => {
    if (!validProjectId(id) || !validEpisode(episode)) throw invalidRequest('项目或集数无效')
    return join(root(), id, 'episodes', String(episode))
  }
  // 每次写入都推进项目修改时间，页面轮询据此刷新。
  async function touch(value) {
    value.updated_at = Math.max(Date.now(), value.updated_at + 1)
    await writeJson(join(root(), value.id, 'project.json'), metadataOf(value))
    modifiedAt.set(value.id, value.updated_at)
  }
  async function saveMaterials(value) {
    const materials = materialIdsOf(value)
    if (materials.length === value.materials.length && materials.every((item, index) => item === value.materials[index])) return
    value.materials = materials
    await writeJson(join(root(), value.id, 'materials.json'), materials)
  }

  async function loadEpisode(id, number) {
    const directory = episodeDirectory(id, number)
    const [acts, deliverables, filmTask] = await Promise.all([readOptional(join(directory, 'storyboard.json'), []),
      readOptional(join(directory, 'deliverables.json'), []), readOptional(join(directory, 'film-task.json'), null)])
    return { number, acts, deliverables, film_task: filmTask }
  }

  async function load(id) {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    const directory = join(root(), id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    const [materials, anchors, planning, auto] = await Promise.all([readOptional(join(directory, 'materials.json'), []), readOptional(join(directory, 'anchors.json'), []),
      readOptional(join(directory, 'planning.json'), null), readOptional(join(directory, 'auto.json'), autoValue({}))])
    const entries = await readdir(join(directory, 'episodes'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const numbers = entries.filter(entry => entry.isDirectory() && validEpisode(Number(entry.name))).map(entry => Number(entry.name)).sort((a, b) => a - b)
    const series = planning?.series.versions.find(item => item.version === planning.series.finalized)?.value
    return { ...metadata, materials, anchors, auto, episodes: await Promise.all(numbers.map(number => loadEpisode(id, number))),
      ...(series ? { planning_episode_count: series.episode_count } : {}) }
  }

  function enqueue(action) {
    const operation = operations.then(action)
    operations = operation.catch(() => {})
    return operation
  }

  const read = id => enqueue(() => load(id))
  async function loadWithEpisode(id, number) {
    const project = await load(id), current = project.episodes.find(item => item.number === number) || await loadEpisode(id, number)
    return { ...project, episode: number, acts: current.acts, deliverables: current.deliverables, film_task: current.film_task }
  }
  const readEpisode = (id, number) => enqueue(() => loadWithEpisode(id, number))
  // 本集分镜内容只来自规划定稿；页面与工具不能增删镜头。
  const saveEpisodeStoryboard = (id, number, acts) => enqueue(async () => {
    const project = await load(id), directory = episodeDirectory(id, number), value = actsValue(acts)
    await mkdir(directory, { recursive: true })
    await writeJson(join(directory, 'storyboard.json'), value)
    project.episodes = [...project.episodes.filter(item => item.number !== number), { ...await loadEpisode(id, number), acts: value }]
    await saveMaterials(project)
    await touch(project)
    return loadWithEpisode(id, number)
  })
  const addEpisodeFilm = (id, number, jobIds, items) => enqueue(async () => {
    const value = await loadWithEpisode(id, number), shots = value.acts.flatMap(act => act.shots)
    if (!shots.length || shots.length !== jobIds.length || shots.some((shot, index) => shot.status !== 'succeeded' || shot.job_id !== jobIds[index])) throw statusError(409, '剧集分镜已变化，请重新合成')
    if (value.deliverables.some(item => item.job_id === items[0].job_id)) return value
    value.deliverables = deliverablesValue([...value.deliverables, ...items])
    await writeJson(join(episodeDirectory(id, number), 'deliverables.json'), value.deliverables)
    value.episodes = value.episodes.map(item => item.number === number ? { ...item, deliverables: value.deliverables } : item)
    await saveMaterials(value)
    await touch(value)
    return value
  })
  const requestEpisodeFilm = (id, number) => enqueue(async () => {
    const value = await loadWithEpisode(id, number), shots = value.acts.flatMap(act => act.shots)
    if (!shots.length || shots.some(shot => shot.status !== 'succeeded' || !validJobId(shot.job_id))) throw statusError(409, '请先完成本集全部镜头')
    const jobIds = shots.map(shot => shot.job_id)
    const taskId = createHash('sha256').update(JSON.stringify([id, number, jobIds])).digest('hex').slice(0, 32)
    if (value.film_task?.task_id === taskId && ['pending', 'running'].includes(value.film_task.status)) return value
    if (value.film_task?.status === 'running') throw statusError(409, '本集合成任务正在执行')
    if (value.deliverables.some(item => item.job_id === taskId)) return value
    const task = { kind: 'film', task_id: taskId, project_id: id, episode: number, job_ids: jobIds, status: 'pending', created_at: Date.now() }
    await mkdir(episodeDirectory(id, number), { recursive: true })
    await writeJson(join(episodeDirectory(id, number), 'film-task.json'), task)
    await touch(value)
    return { ...value, film_task: task }
  })
  const updateEpisodeFilmTask = (id, number, taskId, patch) => enqueue(async () => {
    const value = await loadWithEpisode(id, number)
    if (value.film_task?.task_id !== taskId) return value
    const task = { ...value.film_task, ...patch, updated_at: Date.now() }
    await writeJson(join(episodeDirectory(id, number), 'film-task.json'), task)
    await touch(value)
    return { ...value, film_task: task }
  })

  const planningPath = id => join(root(), id, 'planning.json')
  // 规划变更同样推进项目修改时间，页面据此刷新规划与流水线进度。
  async function savePlanning(id, planning) {
    await writeJson(planningPath(id), planning)
    await touch(JSON.parse(await readFile(join(root(), id, 'project.json'), 'utf8')))
  }
  async function loadPlanning(id) {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    await readFile(join(root(), id, 'project.json'))
    return readOptional(planningPath(id), { series: { versions: [], finalized: null }, episodes: {} })
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
    await savePlanning(id, planning)
    return planning
  })
  const finalizePlanningVersion = (id, step, episode, shotId, version, valueOverride) => enqueue(async () => {
    const planning = await loadPlanning(id), entry = planningEntry(planning, step, episode, shotId)
    const selected = entry.versions.find(item => item.version === version)
    if (!selected) throw invalidRequest('规划版本不存在')
    if (JSON.stringify(selected.based_on || {}) !== JSON.stringify(planningBasis(planning, step, episode))) throw statusError(409, '规划依据已变化，请先复核上游并重新生成')
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
    await savePlanning(id, planning)
    return planning
  })

  async function checkedDirector(value) {
    const name = directorValue(value)
    if (!await directorExists(name)) throw invalidRequest('导演 Skill 不存在')
    return name
  }

  // 封面只能引用已完成且仍可读取的图片素材。
  async function checkedImage(jobId, label) {
    if (!validJobId(jobId)) throw invalidRequest(`${label}素材 ID 无效`)
    const summary = await summarizeJob(await readJob(jobId))
    if (!summary.has_image) throw invalidRequest(`${label}只能使用可用的图片素材`)
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
      if (action === 'create') {
        const now = Date.now()
        let value
        do { value = { id: newId() } } while (value.id === FREE_PROJECT_ID)
        value = { ...value, title: titleValue(body.title), director: await checkedDirector(body.director),
          genre: storyValue(body.genre ?? '', '题材', 200), synopsis: storyValue(body.synopsis ?? '', '梗概'),
          ...(body.cover_job_id === undefined ? {} : { cover_job_id: await checkedImage(body.cover_job_id, '封面') }),
          created_at: now, updated_at: now }
        await mkdir(root(), { recursive: true })
        for (;;) {
          try { await mkdir(join(root(), value.id)); break }
          catch (error) { if (error.code !== 'EEXIST') throw error; value.id = newId() }
        }
        await mkdir(join(root(), value.id, 'media'))
        await writeJson(join(root(), value.id, 'media', 'manifest.json'), { version: 1, project_id: value.id, complete: false, files: [], missing: [] })
        await writeJson(join(root(), value.id, 'anchors.json'), [])
        await writeJson(join(root(), value.id, 'materials.json'), value.cover_job_id ? [value.cover_job_id] : [])
        await writeJson(join(root(), value.id, 'project.json'), value)
        modifiedAt.set(value.id, value.updated_at)
        return load(value.id)
      }
      const value = await load(body.id)
      if (action === 'update') {
        if (body.cover_job_id !== undefined && body.cover_job_id !== value.cover_job_id) value.cover_job_id = await checkedImage(body.cover_job_id, '封面')
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
      } else if (action === 'import') {
        const anchor = value.anchors.find(item => item.role === body.role)
        if (body.as !== 'anchor' || !anchor || anchor.kind !== 'character') throw invalidRequest('素材只能替换角色锚点参考图')
        anchor.source = { type: 'material', job_id: await checkedImage(body.job_id, '锚点') }
        anchor.image_needs_review = false
        value.anchors = anchorsValue(value.anchors)
        await writeJson(join(root(), value.id, 'anchors.json'), value.anchors)
      } else throw invalidRequest('项目操作无效')
      await saveMaterials(value)
      await touch(value)
      return value
    })
  }

  const changeAnchor = (id, action, data) => enqueue(async () => {
    const value = await load(id), index = value.anchors.findIndex(anchor => anchor.role === data.role)
    if (action === 'add') {
      if (index >= 0) throw invalidRequest('锚点已存在')
      value.anchors.push({ source: null, ...data })
    } else if (index < 0) throw invalidRequest('锚点不存在')
    else if (action === 'delete') value.anchors.splice(index, 1)
    else if (action === 'update') value.anchors[index] = { ...value.anchors[index], ...data }
    else throw invalidRequest('锚点操作无效')
    value.anchors = anchorsValue(value.anchors)
    await writeJson(join(root(), id, 'anchors.json'), value.anchors)
    await saveMaterials(value)
    await touch(value)
    return value
  })

  // 镜头只允许更新任务、状态与提示词；expect_* 用于忽略过期任务的回写。
  const changeShot = (id, data) => enqueue(async () => {
    if (!validShotId(data.id)) throw invalidRequest('镜头 ID 无效')
    const value = await loadWithEpisode(id, data.episode), shot = value.acts.flatMap(act => act.shots).find(item => item.id === data.id)
    const { id: _, episode, expect_job_id: expectJob, expect_keyframe_job_id: expectKeyframe, ...patch } = data
    if (!shot || expectJob !== undefined && shot.job_id !== expectJob || expectKeyframe !== undefined && shot.keyframe_job_id !== expectKeyframe) {
      if (!shot && expectJob === undefined && expectKeyframe === undefined) throw invalidRequest('镜头不存在')
      return value
    }
    Object.assign(shot, patch)
    value.acts = actsValue(value.acts)
    await writeJson(join(episodeDirectory(id, episode), 'storyboard.json'), value.acts)
    value.episodes = value.episodes.map(item => item.number === episode ? { ...item, acts: value.acts } : item)
    await saveMaterials(value)
    await touch(value)
    return value
  })

  const changeAuto = (id, mutate) => enqueue(async () => {
    const value = await load(id), next = autoValue(mutate(structuredClone(value.auto)) ?? value.auto)
    if (JSON.stringify(next) === JSON.stringify(value.auto)) return value
    await writeJson(join(root(), id, 'auto.json'), next)
    value.auto = next
    await touch(value)
    return value
  })

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
    change, changeAnchor, changeShot, changeAuto, lastModified, usesDirector,
    readPlanning, appendPlanningVersion, finalizePlanningVersion }
}
