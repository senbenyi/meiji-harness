// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsRoot } from '../paths.js'
import { aspectRatioValue, briefValue, configurationValue, durationMinutesValue, modeValue, anchorsValue, actsValue, deliverablesValue, directorValue, materialsValue, profileValue, serverUrl, shotValue, titleValue, validJobId, validProjectId, validShotId } from '../schemas/projects.js'
import { episodeCountValue, episodeStage, newEpisode } from '../schemas/episodes.js'
import { initialProduction } from '../schemas/production.js'
import { saveProduction, loadProduction } from './production.js'
import { statusError } from '../../utils/errors.js'

const FREE_PROJECT_ID = '00000000'
const invalidRequest = message => statusError(400, message)
const unavailableJob = async () => { throw new Error('项目素材校验服务未配置') }

function plotSummary(value) {
  return [value.production?.story?.text, value.workflow?.plot, value.episodes?.[0]?.workflow?.plot, value.production?.original_request, value.brief]
    .find(item => typeof item === 'string' && item.trim())?.trim() || ''
}

function videoCoverJob(value) {
  for (const item of value.production?.exports || []) if (item.status === 'succeeded' && validJobId(item.job_id)) return item.job_id
  for (const segment of value.production?.segments || []) {
    const selected = segment.generations?.find(item => item.id === segment.selected_generation)
    if (selected?.status === 'succeeded' && validJobId(selected.job_id)) return selected.job_id
    const ready = segment.generations?.find(item => item.status === 'succeeded' && validJobId(item.job_id))
    if (ready) return ready.job_id
  }
  for (const item of value.deliverables || []) if (['film', 'video'].includes(item.type) && validJobId(item.job_id)) return item.job_id
  for (const shot of (value.acts || []).flatMap(act => act.shots || [])) if (shot.status === 'succeeded' && validJobId(shot.job_id)) return shot.job_id
  return null
}

function coverFields(value) {
  if (value.cover_job_id) return { cover_job_id: value.cover_job_id, cover_url: null, cover_kind: 'image' }
  const video = videoCoverJob(value)
  if (video) return { cover_job_id: video, cover_url: null, cover_kind: 'video' }
  const remote = (value.anchors || []).find(anchor => serverUrl(anchor.image_url))
  if (remote) return { cover_job_id: null, cover_url: remote.image_url, cover_kind: 'image' }
  const jobId = (value.anchors || []).find(anchor => validJobId(anchor.source?.job_id))?.source.job_id || null
  return { cover_job_id: jobId, cover_url: null, cover_kind: jobId ? 'image' : null }
}

export function projectSummary(value) {
  const shots = (value.acts || []).flatMap(act => act.shots || [])
  const anchors = value.anchors || [], deliverables = value.deliverables || []
  const active = shots.some(shot => ['queued', 'running'].includes(shot.status))
  const completed = deliverables.length > 0 && shots.every(shot => shot.status === 'succeeded')
  const workflowStage = value.episodes?.length ? episodeStage(value) : value.workflow?.stage
  const production = value.production, productionActive = production && (production.revision || production.segments.length || production.exports.length)
  const productionComplete = production?.exports.some(e => e.status === 'succeeded' && e.source_revision === production.revision && e.timeline_revision === production.timeline.revision)
    && !['running', 'paused', 'stopping'].includes(production.queue?.status)
    && production.segments.every(s => !s.generations.some(g => g.created_at > production.exports.findLast(e => e.status === 'succeeded').created_at))
  const stage = deliverables.length > 0 && completed ? 'deliverables' : shots.length ? shots.some(shot => shot.status !== 'succeeded') ? 'acts' : 'deliverables' : !anchors.length ? 'anchors' : 'acts'
  return {
    ...coverFields(value),
    id: value.id, title: value.title, chat_session_id: value.chat_session_id || null, director: value.director || null, profile: value.profile, created_at: value.created_at, updated_at: value.updated_at,
    mode: value.mode || 'director', workflow: value.workflow, episode_count: value.episode_count || production?.export_episode_count || 1,
    plot_summary: plotSummary(value),
    status: productionActive ? productionComplete ? 'completed' : 'active' : workflowStage ? workflowStage === 'complete' ? 'completed' : ['video', 'submitting', 'plot-generating', 'storyboard-generating', 'failed'].includes(workflowStage) ? 'active' : 'todo' : active ? 'active' : completed ? 'completed' : 'todo', stage: workflowStage || stage,
    segment_count: value.production?.segments.length || 0, production_stage: production?.stage || null, segment_video_count: production?.segments.filter(s => s.generations.some(g => g.status === 'succeeded')).length || 0,
    anchor_count: anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length,
    deliverable_count: deliverables.length,
  }
}

export function createProjectStore({ readJob = unavailableJob, summarizeJob = unavailableJob, newId = () => randomBytes(4).toString('hex'), directorExists = async () => true } = {}) {
  const root = projectsRoot
  const names = { materials: 'materials.json', anchors: 'anchors.json', acts: 'storyboard.json', deliverables: 'deliverables.json' }
  const metadataOf = ({ materials, anchors, acts, deliverables, production, ...metadata }) => metadata
  const materialIdsOf = value => [...new Set([...(value.materials || []), value.cover_job_id,
    ...(value.deliverables || []).map(item => item.job_id), ...value.anchors.map(anchor => anchor.source?.job_id), ...value.acts.flatMap(act => act.shots.map(shot => shot.job_id))].filter(validJobId))]
  const modifiedAt = new Map()
  let operations = Promise.resolve()

  async function writeJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }) }
  }

  async function writeProject(directory, value, sections) {
    if (value.episodes) sections = [...sections, 'acts', 'deliverables']
    await Promise.all([...new Set(sections)].map(key => writeJson(join(directory, names[key]), value[key])))
    if (value.production) value.production_snapshot = await saveProduction(directory, value.production)
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

  async function load(id) {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    const directory = join(root(), id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    const [anchors, acts, deliverables] = await Promise.all(['anchors', 'acts', 'deliverables'].map(key => readFile(join(directory, names[key]), 'utf8').then(JSON.parse)))
    let materials
    try { materials = JSON.parse(await readFile(join(directory, names.materials), 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      materials = materialIdsOf({ ...metadata, materials: [], anchors, acts })
      await writeJson(join(directory, names.materials), materials)
    }
    if (ensureShotIds(acts)) await writeJson(join(directory, names.acts), acts)
    return { ...metadata, materials, anchors, acts, deliverables, ...(metadata.production_snapshot ? { production: await loadProduction(directory, metadata.production_snapshot) } : {}) }
  }

  function enqueue(action) {
    const operation = operations.then(action)
    operations = operation.catch(() => {})
    return operation
  }

  const read = id => enqueue(() => load(id))

  async function checkedDirector(value) {
    const name = directorValue(value)
    if (!await directorExists(name)) throw invalidRequest('导演不存在，请先在导演库中添加')
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
      } catch (error) { if (error.code === 'ENOENT' || error.status === 409) continue; throw error }
    }
    return items.sort((a, b) => b.updated_at - a.updated_at)
  })

  async function change(action, body) {
    if (action !== 'create' && !validProjectId(body.id)) throw invalidRequest('项目 ID 无效')
    return enqueue(async () => {
      if (action === 'delete') {
        await readFile(join(root(), body.id, 'project.json'))
        await rm(join(root(), body.id), { recursive: true, force: true })
        modifiedAt.delete(body.id)
        return { deleted: true }
      }
      let value, sections
      if (action === 'create') {
        const now = Date.now()
        do { value = { id: newId() } } while (value.id === FREE_PROJECT_ID)
        const director = body.director ? await checkedDirector(body.director) : null
        const count = episodeCountValue(body.episode_count ?? 1)
        value = { ...value, title: titleValue(body.title), director, profile: profileValue(body.profile || 'regular'), mode: modeValue(body.mode), brief: briefValue(body.brief || body.title), configuration: configurationValue({ director, reference_text: body.reference_text || '' }), aspect_ratio: aspectRatioValue(body.aspect_ratio), duration_min: body.duration_min == null ? null : durationMinutesValue(body.duration_min), workflow: { revision: 0, stage: 'configuration', plot: '', storyboard_revision: null, request: null, approval: null, job_id: null }, created_at: now, updated_at: now, materials: [], anchors: [], acts: [], deliverables: [] }
        value.schema_version = 3; value.production = initialProduction(value)
        value.episode_count = count
        value.episodes = count === 1 ? [{ ...newEpisode(1), workflow: value.workflow }] : Array.from({ length: count }, (_, index) => newEpisode(index + 1))
        if (body.cover_job_id !== undefined) { value.cover_job_id = await checkedCover(body.cover_job_id); value.materials = [value.cover_job_id] }
        sections = ['materials', 'anchors', 'acts', 'deliverables']
        await mkdir(root(), { recursive: true })
        for (;;) {
          try { await mkdir(join(root(), value.id)); break }
          catch (error) { if (error.code !== 'EEXIST') throw error; value.id = newId() }
        }
        await Promise.all(['jobs', 'production', 'media'].map(name => mkdir(join(root(), value.id, name))))
        await writeJson(join(root(), value.id, 'media', 'manifest.json'), { version: 1, project_id: value.id, complete: false, files: [], missing: [] })
      } else {
        value = await load(body.id)
        sections = []
        if (body.cover_job_id !== undefined && body.cover_job_id !== value.cover_job_id) value.cover_job_id = await checkedCover(body.cover_job_id)
        if (body.title !== undefined) value.title = titleValue(body.title)
        if (body.director !== undefined) value.director = body.director ? await checkedDirector(body.director) : null
        if (body.mode !== undefined) value.mode = modeValue(body.mode)
        if (body.brief !== undefined) value.brief = briefValue(body.brief)
        if (body.profile !== undefined) value.profile = profileValue(body.profile)
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
        if (value.workflow && ['director', 'profile', 'mode', 'brief', 'anchors', 'acts'].some(key => body[key] !== undefined)) {
          for (const w of new Set([value.workflow, ...(value.episodes || []).map(episode => episode.workflow)])) { w.revision++; w.approval = null; w.request = null; w.storyboard_revision = null; w.job_id = null; w.plot_stale = Boolean(w.plot); w.stage = 'configuration' }
          if (['director', 'mode', 'brief', 'anchors'].some(key => body[key] !== undefined)) value.workflow.plot_stale = true
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
  function changeObject(id, mutate, workflowOperation = false) {
    return enqueue(async () => {
      const value = await load(id)
      const sections = await mutate(value)
      if (value.workflow && !workflowOperation) { for (const w of new Set([value.workflow, ...(value.episodes || []).map(episode => episode.workflow)])) { w.revision++; w.approval = null; w.request = null; w.storyboard_revision = null; w.job_id = null; w.plot_stale = Boolean(w.plot); w.stage = 'configuration' } }
      value.anchors = anchorsValue(value.anchors)
      value.acts = actsValue(value.acts)
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
  })

  const changeShot = (id, action, data) => changeObject(id, value => {
    if (!['add', 'update', 'delete', 'move'].includes(action)) throw invalidRequest('镜头操作无效')
    if (action === 'add') {
      if (!Number.isInteger(data.act_index) || !value.acts[data.act_index]) throw invalidRequest('幕不存在')
      value.acts[data.act_index].shots.push(shotValue({ role: '', action: '', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '', ...data, id: undefined }))
      ensureShotIds(value.acts)
    } else {
      if (!validShotId(data.id)) throw invalidRequest('镜头 ID 无效')
      const act = value.acts.find(act => act.shots.some(shot => shot.id === data.id))
      if (!act) throw invalidRequest('镜头不存在')
      const index = act.shots.findIndex(shot => shot.id === data.id)
      if (action === 'update') act.shots[index] = { ...act.shots[index], ...data }
      if (action === 'delete') act.shots.splice(index, 1)
      if (action === 'move') {
        if (![1, -1].includes(data.direction) || !act.shots[index + data.direction]) throw invalidRequest('移动方向无效或已到幕边界')
        const target = index + data.direction
        ;[act.shots[index], act.shots[target]] = [act.shots[target], act.shots[index]]
      }
    }
    return ['acts']
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

  return { list, read, change, transact: (id, mutate) => changeObject(id, mutate, true), changeAnchor, changeAct, changeShot, lastModified, usesDirector }
}
