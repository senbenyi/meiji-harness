import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig, withConfig } from '../config.js'
import { getJob } from '../jobs/query.js'
import { authenticated, json, jobSummary } from './media-jobs.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/project'
const invalid = message => Object.assign(new Error(message), { status: 400 })
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}$/.test(id)
const titleValue = title => {
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw invalid('请输入项目标题（最多 500 字）')
  return title.trim()
}
const profiles = ['preview', 'regular', 'high-quality', 'hd']
const profileValue = value => { if (!profiles.includes(value)) throw invalid('档次无效'); return value }
const textValue = value => typeof value === 'string' && value.length <= 20000
const jobIdValue = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const serverUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
function anchorsValue(anchors) {
  if (!Array.isArray(anchors) || anchors.length > 1000) throw invalid('锚点列表无效')
  const roles = new Set()
  return anchors.map(anchor => {
    if (!anchor || !['role', 'label', 'description'].every(key => textValue(anchor[key])) || !anchor.role.trim() || roles.has(anchor.role) ||
      !(anchor.image_url === '' || serverUrl(anchor.image_url)) ||
      !(anchor.source === null || anchor.source && ['job', 'material'].includes(anchor.source.type) && jobIdValue(anchor.source.job_id))) throw invalid('锚点字段无效或角色重复')
    roles.add(anchor.role)
    return { role: anchor.role, label: anchor.label, description: anchor.description, source: anchor.source, image_url: anchor.image_url }
  })
}
function actsValue(acts) {
  if (!Array.isArray(acts) || acts.length > 1000) throw invalid('幕列表无效')
  let index = 0
  return acts.map(act => {
    if (!act || !textValue(act.title) || !Array.isArray(act.shots)) throw invalid('幕字段无效')
    return { title: act.title, shots: act.shots.map(shot => {
      if (++index > 1000 || !shot || !['role', 'action', 'subtitle', 'mode', 'notes'].every(key => textValue(shot[key])) ||
        !(shot.job_id === null || jobIdValue(shot.job_id)) || !['pending', 'queued', 'running', 'succeeded', 'failed'].includes(shot.status)) throw invalid('镜字段无效或超过 1000 镜')
      return { index, role: shot.role, action: shot.action, subtitle: shot.subtitle, mode: shot.mode, job_id: shot.job_id, status: shot.status, notes: shot.notes }
    }) }
  })
}
function deliverablesValue(items) {
  if (!Array.isArray(items) || items.length > 1000) throw invalid('交付列表无效')
  return items.map(item => {
    if (!item || !['type', 'label'].every(key => textValue(item[key])) ||
      !(jobIdValue(item.job_id) || serverUrl(item.url)) || (item.url !== undefined && !serverUrl(item.url)) ||
      (item.job_id !== undefined && !jobIdValue(item.job_id)) ||
      ['duration_sec', 'frame_count', 'size_bytes', 'created_at'].some(key => item[key] !== undefined && (!Number.isFinite(item[key]) || item[key] < 0))) throw invalid('交付物需提供任务 ID 或服务器 URL，规格必须为非负数')
    return Object.fromEntries(['type', 'label', 'job_id', 'url', 'duration_sec', 'frame_count', 'size_bytes', 'created_at'].filter(key => item[key] !== undefined).map(key => [key, item[key]]))
  })
}
async function bodyJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('项目数据过大'), { status: 413 })
    chunks.push(Buffer.from(chunk))
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('JSON 对象无效')
    return value
  } catch { throw invalid('JSON 对象无效') }
}
export function createProjectHandler({ token, readJob = getJob, newId = () => randomBytes(4).toString('hex') }) {
  let writes = Promise.resolve()
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(PROJECT_ROUTE.length + 1)
      if (!['list', 'get', 'create', 'update', 'delete', 'import'].includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'get'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      const root = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'projects')
      const read = async id => JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8'))
      if (action === 'list') {
        const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
        const items = []
        for (const entry of entries) {
          if (!entry.isDirectory() || !validId(entry.name)) continue
          try {
            const value = await read(entry.name)
            const shots = value.acts.flatMap(act => act.shots)
            items.push({ cover_url: value.anchors.find(anchor => serverUrl(anchor.image_url))?.image_url || null, id: value.id, title: value.title, profile: value.profile, created_at: value.created_at, updated_at: value.updated_at, anchor_count: value.anchors.length, shot_count: shots.length, completed_count: shots.filter(shot => shot.status === 'succeeded').length })
          } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return json(res, 200, items.sort((a, b) => b.updated_at - a.updated_at))
      }
      if (action === 'get') {
        const id = url.searchParams.get('id')
        if (!validId(id)) throw invalid('项目 ID 无效')
        return json(res, 200, await read(id))
      }
      const body = await bodyJson(req)
      if (action !== 'create' && !validId(body.id)) throw invalid('项目 ID 无效')
      const operation = writes.then(async () => {
        if (action === 'delete') {
          await read(body.id)
          await rm(join(root, body.id), { recursive: true, force: true })
          return { deleted: true }
        }
        let value
        if (action === 'create') {
          const title = titleValue(body.title), profile = profileValue(body.profile), now = Date.now()
          value = { id: newId(), title, profile, created_at: now, updated_at: now, anchors: [], acts: [], deliverables: [] }
          await mkdir(root, { recursive: true })
          for (;;) {
            try { await mkdir(join(root, value.id)); break }
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
            if (body.as !== 'anchor' || !jobIdValue(body.job_id)) throw invalid('素材引入参数无效')
            const job = await readJob(body.job_id), summary = jobSummary(job)
            if (!(summary.has_image || summary.has_video) || !serverUrl(job.result.comfyui_view_url)) throw invalid('素材尚不可用')
            const role = body.role || `material-${body.job_id}`
            const previous = value.anchors.find(anchor => anchor.role === role)
            const anchor = { role, label: previous?.label || '素材锚点', description: previous?.description || '', source: { type: 'material', job_id: body.job_id }, image_url: summary.has_image ? job.result.comfyui_view_url : '' }
            value.anchors = anchorsValue(previous ? value.anchors.map(item => item.role === role ? anchor : item) : [...value.anchors, anchor])
          }
          value.updated_at = Date.now()
        }
        const path = join(root, value.id, 'project.json'), temporary = `${path}.${randomUUID()}.tmp`
        try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
        finally { await rm(temporary, { force: true }) }
        return value
      })
      writes = operation.catch(() => {})
      return json(res, action === 'create' ? 201 : 200, await operation)
    } catch (error) {
      json(res, error.status || (['ENOENT', 'MODEL_JOB_NOT_FOUND'].includes(error.code) ? 404 : 503), { error: error.status ? error.message : ['ENOENT', 'MODEL_JOB_NOT_FOUND'].includes(error.code) ? '项目或素材不存在' : '暂时无法读取或保存项目' })
    }
  }
}
export function registerProjectRoutes(ctx, runtime, token) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createProjectHandler({ token })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of ['list', 'get', 'create', 'update', 'delete', 'import']) ctx.effect(() => server.register({ kind: 'exact', path: `${PROJECT_ROUTE}/${suffix}`, handler }), `elysium project ${suffix}`)
}
