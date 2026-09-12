import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig, withConfig } from '../config.js'
import { authenticated, json } from './media-jobs.js'

export const STORYBOARD_ROUTE = '/plugins/dsh-elysium/storyboard'
const invalid = message => Object.assign(new Error(message), { status: 400 })
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}$/.test(id)
const titleValue = title => {
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw invalid('请输入分镜标题（最多 500 字）')
  return title.trim()
}
function shotsValue(shots) {
  if (!Array.isArray(shots) || shots.length > 1000) throw invalid('镜头列表格式错误或超过 1000 项')
  return shots.map((shot, index) => {
    if (!shot || typeof shot !== 'object' || ['label', 'prompt', 'notes'].some(key => typeof shot[key] !== 'string' || shot[key].length > 20000) ||
      !(shot.job_id === null || typeof shot.job_id === 'string' && /^[a-f0-9]{32}$/.test(shot.job_id)) ||
      !['pending', 'queued', 'running', 'succeeded', 'failed'].includes(shot.status)) throw invalid('镜头字段格式错误')
    return { index: index + 1, label: shot.label, prompt: shot.prompt, job_id: shot.job_id, status: shot.status, notes: shot.notes }
  })
}
async function bodyJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('分镜数据过大'), { status: 413 })
    chunks.push(Buffer.from(chunk))
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('JSON 对象无效')
    return value
  } catch { throw invalid('JSON 对象无效') }
}
export function createStoryboardHandler({ token }) {
  let writes = Promise.resolve()
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      const action = url.pathname.slice(STORYBOARD_ROUTE.length + 1)
      if (!['list', 'get', 'create', 'update', 'delete'].includes(action)) return json(res, 404, { error: '接口不存在' })
      if (req.method !== (['list', 'get'].includes(action) ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' })
      const root = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'storyboards')
      const read = async id => JSON.parse(await readFile(join(root, id, 'manifest.json'), 'utf8'))
      if (action === 'list') {
        const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
        const items = []
        for (const entry of entries) {
          if (!entry.isDirectory() || !validId(entry.name)) continue
          try {
            const value = await read(entry.name)
            items.push({ id: value.id, title: value.title, created_at: value.created_at, updated_at: value.updated_at, shot_count: value.shots.length, completed_count: value.shots.filter(shot => shot.status === 'succeeded').length })
          } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return json(res, 200, items.sort((a, b) => b.updated_at - a.updated_at))
      }
      if (action === 'get') {
        const id = url.searchParams.get('id')
        if (!validId(id)) throw invalid('分镜 ID 无效')
        return json(res, 200, await read(id))
      }
      const body = await bodyJson(req)
      if (action !== 'create' && !validId(body.id)) throw invalid('分镜 ID 无效')
      const operation = writes.then(async () => {
        if (action === 'delete') {
          await read(body.id)
          await rm(join(root, body.id), { recursive: true, force: true })
          return { deleted: true }
        }
        let value
        if (action === 'create') {
          const title = titleValue(body.title), now = Date.now()
          value = { id: randomBytes(4).toString('hex'), title, created_at: now, updated_at: now, shots: [] }
          await mkdir(root, { recursive: true })
          await mkdir(join(root, value.id))
        } else {
          value = await read(body.id)
          if (body.title !== undefined) value.title = titleValue(body.title)
          if (body.shots !== undefined) value.shots = shotsValue(body.shots)
          value.updated_at = Date.now()
        }
        const path = join(root, value.id, 'manifest.json'), temporary = `${path}.${randomUUID()}.tmp`
        try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path) }
        finally { await rm(temporary, { force: true }) }
        return value
      })
      writes = operation.catch(() => {})
      return json(res, action === 'create' ? 201 : 200, await operation)
    } catch (error) {
      json(res, error.status || (error.code === 'ENOENT' ? 404 : 503), { error: error.status ? error.message : error.code === 'ENOENT' ? '分镜不存在' : '暂时无法读取或保存分镜' })
    }
  }
}
export function registerStoryboardRoutes(ctx, runtime, token) {
  const server = ctx.get?.('webServer')
  if (!server) return
  const handle = createStoryboardHandler({ token })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of ['list', 'get', 'create', 'update', 'delete']) ctx.effect(() => server.register({ kind: 'exact', path: `${STORYBOARD_ROUTE}/${suffix}`, handler }), `elysium storyboard ${suffix}`)
}
