// 职责：持久化项目 JSON，串行化变更，并执行素材引入的业务规则。
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { getJob } from '../jobs/query.js'
import { jobSummary } from '../assets/catalog.js'
import { anchorsValue, actsValue, deliverablesValue, profileValue, serverUrl, titleValue, validJobId, validProjectId } from './schema.js'
import { invalidRequest } from '../http/shared.js'

export function createProjectStore({ readJob = getJob, newId = () => randomBytes(4).toString('hex') } = {}) {
  const root = () => join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects')
  const read = async id => JSON.parse(await readFile(join(root(), id, 'project.json'), 'utf8'))
  let writes = Promise.resolve()

  async function list() {
    const entries = await readdir(root(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validProjectId(entry.name)) continue
      try {
        const value = await read(entry.name), shots = value.acts.flatMap(act => act.shots)
        items.push({ cover_url: value.anchors.find(anchor => serverUrl(anchor.image_url))?.image_url || null, id: value.id, title: value.title, profile: value.profile, created_at: value.created_at, updated_at: value.updated_at, anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length })
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return items.sort((a, b) => b.updated_at - a.updated_at)
  }

  async function change(action, body) {
    if (action !== 'create' && !validProjectId(body.id)) throw invalidRequest('项目 ID 无效')
    const operation = writes.then(async () => {
      if (action === 'delete') {
        await read(body.id)
        await rm(join(root(), body.id), { recursive: true, force: true })
        return { deleted: true }
      }
      let value
      if (action === 'create') {
        const now = Date.now()
        value = { id: newId(), title: titleValue(body.title), profile: profileValue(body.profile), created_at: now, updated_at: now, anchors: [], acts: [], deliverables: [] }
        await mkdir(root(), { recursive: true })
        for (;;) {
          try { await mkdir(join(root(), value.id)); break }
          catch (error) { if (error.code !== 'EEXIST') throw error; value.id = newId() }
        }
      } else {
        value = await read(body.id)
        if (body.title !== undefined) value.title = titleValue(body.title)
        if (body.profile !== undefined) value.profile = profileValue(body.profile)
        if (body.anchors !== undefined) value.anchors = anchorsValue(body.anchors)
        if (body.acts !== undefined) value.acts = actsValue(body.acts)
        if (body.deliverables !== undefined) value.deliverables = deliverablesValue(body.deliverables)
        if (action === 'import') {
          if (body.as !== 'anchor' || !validJobId(body.job_id)) throw invalidRequest('素材引入参数无效')
          const job = await readJob(body.job_id), summary = jobSummary(job)
          if (!(summary.has_image || summary.has_video) || !serverUrl(job.result.comfyui_view_url)) throw invalidRequest('素材尚不可用')
          const role = body.role || `material-${body.job_id}`
          const previous = value.anchors.find(anchor => anchor.role === role)
          const anchor = { role, label: previous?.label || '素材锚点', description: previous?.description || '', source: { type: 'material', job_id: body.job_id }, image_url: summary.has_image ? job.result.comfyui_view_url : '' }
          value.anchors = anchorsValue(previous ? value.anchors.map(item => item.role === role ? anchor : item) : [...value.anchors, anchor])
        }
        value.updated_at = Date.now()
      }
      const path = join(root(), value.id, 'project.json'), temporary = `${path}.${randomUUID()}.tmp`
      try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
      finally { await rm(temporary, { force: true }) }
      return value
    })
    writes = operation.catch(() => {})
    return operation
  }

  return { list, read, change }
}
