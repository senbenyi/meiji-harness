// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsRoot } from '../../utils/storage-paths.js'
import { getJob } from '../jobs/query.js'
import { FREE_PROJECT_ID } from '../jobs/paths.js'
import { availableJobSummary } from '../assets/catalog.js'
import { anchorsValue, actsValue, deliverablesValue, directorValue, materialsValue, profileValue, serverUrl, shotValue, titleValue, validJobId, validProjectId, validShotId } from './schema.js'
import { invalidRequest } from '../../http/shared.js'

export function projectSummary(value) {
  const shots = value.acts.flatMap(act => act.shots)
  const active = shots.some(shot => ['queued', 'running'].includes(shot.status))
  const completed = value.deliverables.length > 0 && shots.every(shot => shot.status === 'succeeded')
  const stage = value.deliverables.length > 0 && completed ? 'deliverables' : shots.length ? shots.some(shot => shot.status !== 'succeeded') ? 'acts' : 'deliverables' : !value.anchors.length ? 'anchors' : 'acts'
  return {
    cover_job_id: value.cover_job_id || (value.anchors.some(anchor => serverUrl(anchor.image_url)) ? null : value.anchors.find(anchor => anchor.source?.job_id)?.source.job_id || null),
    cover_url: value.cover_job_id ? null : value.anchors.find(anchor => serverUrl(anchor.image_url))?.image_url || null,
    id: value.id, title: value.title, director: value.director || null, profile: value.profile, created_at: value.created_at, updated_at: value.updated_at,
    status: active ? 'active' : completed ? 'completed' : 'todo', stage,
    anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length,
    deliverable_count: value.deliverables.length,
  }
}

export function createProjectStore({ readJob = getJob, newId = () => randomBytes(4).toString('hex'), directorExists = async () => true } = {}) {
  const root = projectsRoot
  const names = { materials: 'materials.json', anchors: 'anchors.json', acts: 'storyboard.json', deliverables: 'deliverables.json' }
  const metadataOf = ({ materials, anchors, acts, deliverables, ...metadata }) => metadata
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

  async function load(id) {
    if (!validProjectId(id)) throw invalidRequest('项目 ID 无效')
    const directory = join(root(), id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    if (['anchors', 'acts', 'deliverables'].some(key => Object.hasOwn(metadata, key))) {
      const value = { ...metadata, materials: metadata.materials || [], anchors: metadata.anchors || [], acts: metadata.acts || [], deliverables: metadata.deliverables || [] }
      ensureShotIds(value.acts)
      value.materials = materialIdsOf(value)
      await writeProject(directory, value, ['materials', 'anchors', 'acts', 'deliverables'])
      return value
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
    return { ...metadata, materials, anchors, acts, deliverables }
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
    const summary = await availableJobSummary(await readJob(jobId))
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
        await rm(join(root(), body.id), { recursive: true, force: true })
        modifiedAt.delete(body.id)
        return { deleted: true }
      }
      let value, sections
      if (action === 'create') {
        const now = Date.now()
        do { value = { id: newId() } } while (value.id === FREE_PROJECT_ID)
        value = { ...value, title: titleValue(body.title), director: await checkedDirector(body.director), profile: profileValue(body.profile), created_at: now, updated_at: now, materials: [], anchors: [], acts: [], deliverables: [] }
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
        if (body.director !== undefined) value.director = await checkedDirector(body.director)
        if (body.profile !== undefined) value.profile = profileValue(body.profile)
        if (body.materials !== undefined) { value.materials = materialsValue(body.materials); sections.push('materials') }
        if (body.anchors !== undefined) { value.anchors = anchorsValue(body.anchors); sections.push('anchors') }
        if (body.acts !== undefined) { value.acts = actsValue(body.acts); ensureShotIds(value.acts); sections.push('acts') }
        if (body.deliverables !== undefined) { value.deliverables = deliverablesValue(body.deliverables); sections.push('deliverables') }
        if (action === 'import') {
          if (body.as !== 'anchor' || !validJobId(body.job_id)) throw invalidRequest('素材引入参数无效')
          const job = await readJob(body.job_id), summary = await availableJobSummary(job)
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
  function changeObject(id, mutate) {
    return enqueue(async () => {
      const value = await load(id)
      const sections = mutate(value)
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

  return { list, read, change, changeAnchor, changeAct, changeShot, lastModified, usesDirector }
}
