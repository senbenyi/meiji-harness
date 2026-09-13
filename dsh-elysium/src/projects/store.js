// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { getJob } from '../jobs/query.js'
import { jobSummary } from '../assets/catalog.js'
import { anchorsValue, actsValue, deliverablesValue, directorValue, materialsValue, profileValue, serverUrl, titleValue, validJobId, validProjectId } from './schema.js'
import { invalidRequest } from '../http/shared.js'

export function projectSummary(value) {
  const shots = value.acts.flatMap(act => act.shots)
  const active = shots.some(shot => ['queued', 'running'].includes(shot.status))
  const completed = value.deliverables.length > 0 && shots.every(shot => shot.status === 'succeeded')
  const stage = value.deliverables.length > 0 && completed ? 'deliverables' : shots.length ? shots.some(shot => shot.status !== 'succeeded') ? 'acts' : 'deliverables' : !value.anchors.length ? 'anchors' : 'acts'
  return {
    cover_url: value.anchors.find(anchor => serverUrl(anchor.image_url))?.image_url || null,
    id: value.id, title: value.title, director: value.director || null, profile: value.profile, created_at: value.created_at, updated_at: value.updated_at,
    status: active ? 'active' : completed ? 'completed' : 'todo', stage,
    anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length,
    deliverable_count: value.deliverables.length,
  }
}

export function createProjectStore({ readJob = getJob, newId = () => randomBytes(4).toString('hex'), directorExists = async () => true } = {}) {
  const root = () => join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects')
  const names = { materials: 'materials.json', anchors: 'anchors.json', acts: 'storyboard.json', deliverables: 'deliverables.json' }
  const metadataOf = ({ materials, anchors, acts, deliverables, ...metadata }) => metadata
  const materialIdsOf = value => [...new Set([...(value.materials || []),
    ...value.anchors.map(anchor => anchor.source?.job_id), ...value.acts.flatMap(act => act.shots.map(shot => shot.job_id))].filter(validJobId))]
  let operations = Promise.resolve()

  async function writeJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }) }
  }

  async function writeProject(directory, value, sections) {
    await Promise.all([...new Set(sections)].map(key => writeJson(join(directory, names[key]), value[key])))
    await writeJson(join(directory, 'project.json'), metadataOf(value))
  }

  async function load(id) {
    const directory = join(root(), id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    if (['anchors', 'acts', 'deliverables'].some(key => Object.hasOwn(metadata, key))) {
      const value = { ...metadata, materials: metadata.materials || [], anchors: metadata.anchors || [], acts: metadata.acts || [], deliverables: metadata.deliverables || [] }
      value.materials = materialIdsOf(value)
      await writeProject(directory, value, ['materials', 'anchors', 'acts', 'deliverables'])
      return value
    }
    const [anchors, acts, deliverables] = await Promise.all(['anchors', 'acts', 'deliverables'].map(key => readFile(join(directory, names[key]), 'utf8').then(JSON.parse)))
    let materials
    try { materials = JSON.parse(await readFile(join(directory, names.materials), 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      materials = materialIdsOf({ materials: [], anchors, acts })
      await writeJson(join(directory, names.materials), materials)
    }
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

  const list = () => enqueue(async () => {
    const entries = await readdir(root(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validProjectId(entry.name)) continue
      try {
        items.push(projectSummary(await load(entry.name)))
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
        return { deleted: true }
      }
      let value, sections
      if (action === 'create') {
        const now = Date.now()
        value = { id: newId(), title: titleValue(body.title), director: await checkedDirector(body.director), profile: profileValue(body.profile), created_at: now, updated_at: now, materials: [], anchors: [], acts: [], deliverables: [] }
        sections = ['materials', 'anchors', 'acts', 'deliverables']
        await mkdir(root(), { recursive: true })
        for (;;) {
          try { await mkdir(join(root(), value.id)); break }
          catch (error) { if (error.code !== 'EEXIST') throw error; value.id = newId() }
        }
      } else {
        value = await load(body.id)
        sections = []
        if (body.title !== undefined) value.title = titleValue(body.title)
        if (body.director !== undefined) value.director = await checkedDirector(body.director)
        if (body.profile !== undefined) value.profile = profileValue(body.profile)
        if (body.materials !== undefined) { value.materials = materialsValue(body.materials); sections.push('materials') }
        if (body.anchors !== undefined) { value.anchors = anchorsValue(body.anchors); sections.push('anchors') }
        if (body.acts !== undefined) { value.acts = actsValue(body.acts); sections.push('acts') }
        if (body.deliverables !== undefined) { value.deliverables = deliverablesValue(body.deliverables); sections.push('deliverables') }
        if (action === 'import') {
          if (body.as !== 'anchor' || !validJobId(body.job_id)) throw invalidRequest('素材引入参数无效')
          const job = await readJob(body.job_id), summary = jobSummary(job)
          if (!(summary.has_image || summary.has_video) || !serverUrl(job.result.comfyui_view_url)) throw invalidRequest('素材尚不可用')
          const role = body.role || `material-${body.job_id}`
          const previous = value.anchors.find(anchor => anchor.role === role)
          const anchor = { role, label: previous?.label || '素材锚点', description: previous?.description || '', source: { type: 'material', job_id: body.job_id }, image_url: summary.has_image ? job.result.comfyui_view_url : '' }
          value.anchors = anchorsValue(previous ? value.anchors.map(item => item.role === role ? anchor : item) : [...value.anchors, anchor])
          sections.push('anchors')
        }
        const materials = materialIdsOf(value)
        if (materials.some((id, index) => id !== value.materials[index]) || materials.length !== value.materials.length) { value.materials = materials; sections.push('materials') }
        value.updated_at = Date.now()
      }
      await writeProject(join(root(), value.id), value, sections)
      return value
    })
  }

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

  return { list, read, change, usesDirector }
}
