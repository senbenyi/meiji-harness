import { createWriteStream } from 'node:fs'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile, open, unlink, realpath } from 'node:fs/promises'
import { join, extname, relative, isAbsolute } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { byteRange, jobSummary } from '../http/media-jobs.js'
import { getJob } from '../functions/common/task.js'
import { createProject, listProjects, readProject, renameProject, deleteProject, updateProject, projectDirectory,
  projectJobs, adoptVideo, safeArtifact, fail } from './store.js'

export const PROJECT_ROUTE = '/plugins/dsh-elysium/projects'
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw fail('请求过大', 413); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw fail('无效请求') }
}
export async function projectDetail(id, readJob) {
  const project = await readProject(id), jobs = await projectJobs(id)
  return { ...project, brief: await readFile(join(projectDirectory(id), 'brief.md'), 'utf8'), jobs: await Promise.all(jobs.jobs.map(async row => {
    try { return { ...jobSummary(await readJob(row.jobId)), jobId: row.jobId, createdAt: row.createdAt } }
    catch { return { jobId: row.jobId, status: 'unavailable', error: '暂时无法读取制作任务' } }
  })) }
}
async function upload(req, id, name) {
  await readProject(id)
  const suffix = extname(name || '').toLowerCase()
  if (!types[suffix] || name.length > 200) throw fail('支持 PNG、JPG、WebP、MP4、MP3、WAV，名称最多200字符')
  const asset = { id: randomUUID(), name, filename: `${randomUUID()}${suffix}` }
  const path = join(projectDirectory(id), 'assets', asset.filename)
  let size = 0
  try {
    const limit = new Transform({ transform(chunk, _, callback) {
      size += chunk.length
      callback(size > 100 * 1024 * 1024 ? fail('单个素材不能超过100MB', 413) : null, chunk)
    } })
    await pipeline(req, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
    if (!size) throw fail('素材不能为空')
    await updateProject(id, p => { p.assets.push({ ...asset, size }) })
    return asset
  } catch (error) { await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e }); throw error }
}
async function sendFile(req, res, url, readJob) {
  const id = url.searchParams.get('id'), project = await readProject(id)
  let path, filename
  const asset = project.assets.find(a => a.id === url.searchParams.get('asset'))
  const saved = project.exports.find(e => e.jobId === url.searchParams.get('export'))
  if (asset) { filename = asset.filename; path = join(projectDirectory(id), 'assets', filename) }
  else if (saved) { filename = saved.filename; path = join(projectDirectory(id), 'exports', filename) }
  else if (url.searchParams.has('job')) {
    const jobId = url.searchParams.get('job')
    if (!(await projectJobs(id)).jobs.some(j => j.jobId === jobId)) throw fail('任务不属于当前短剧', 403)
    const job = await readJob(jobId)
    if (job.status !== 'succeeded' || !job.result?.path) throw fail('成片尚未完成', 409)
    path = job.result.path; filename = `${jobId}.mp4`
  } else throw fail('素材不存在', 404)
  const actual = await safeArtifact(path)
  if (asset || saved) {
    const rel = relative(await realpath(projectDirectory(id)), actual)
    if (rel.startsWith('..') || isAbsolute(rel)) throw fail('素材路径无效', 403)
  }
  const handle = await open(actual, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw fail('素材不存在', 404)
    let range
    try { range = byteRange(req.headers.range, stat.size) } catch {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return
    }
    const headers = { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Content-Length': range ? range.end - range.start + 1 : stat.size }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
    if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${filename}"`
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD') res.end()
    else await pipeline(handle.createReadStream({ ...range, autoClose: false }), res)
  } finally { await handle.close() }
}
export function createProjectsHandler({ token, ensureSession, readJob = getJob }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), expected = Buffer.from(token)
      const supplied = Buffer.from(req.headers['x-elysium-token'] || url.searchParams.get('t') || '')
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fail('页面凭据已失效，请刷新页面', 401)
      // Browser credentials are shared by this single-user Harness instance; do not enable CORS.
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('不允许跨站请求', 403)
      if (url.pathname === `${PROJECT_ROUTE}/file` && ['GET', 'HEAD'].includes(req.method)) return await sendFile(req, res, url, readJob)
      if (url.pathname === `${PROJECT_ROUTE}/asset` && req.method === 'PUT') return json(res, 201, await upload(req, url.searchParams.get('id'), url.searchParams.get('name')))
      if (url.pathname !== PROJECT_ROUTE) throw fail('接口不存在', 404)
      if (req.method === 'GET') {
        if (url.searchParams.has('id')) return json(res, 200, await projectDetail(url.searchParams.get('id'), readJob))
        const projects = await listProjects()
        if (url.searchParams.has('session')) {
          const p = projects.find(p => p.sessionId === url.searchParams.get('session'))
          return json(res, 200, p ? await projectDetail(p.id, readJob) : null)
        }
        return json(res, 200, projects.map(({ id, name, sessionId, updatedAt }) => ({ id, name, sessionId, updatedAt })))
      }
      if (req.method !== 'POST') throw fail('Method not allowed', 405)
      const args = await body(req)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('无效请求')
      if (args.action === 'create') return json(res, 201, await createProject(args.name))
      const project = await readProject(args.id)
      if (args.action === 'open') {
        await ensureSession(project)
        return json(res, 200, { sessionId: project.sessionId, cwd: projectDirectory(project.id) })
      }
      if (args.action === 'rename') return json(res, 200, await renameProject(args.id, args.name))
      if (args.action === 'delete') {
        await deleteProject(args.id, async () => {
          const detail = await projectDetail(args.id, readJob)
          if (detail.jobs.some(j => !['succeeded', 'failed'].includes(j.status))) throw fail('请等待制作结束或确认任务状态后再删除', 409)
        })
        return json(res, 200, { deleted: true })
      }
      if (args.action === 'adopt') return json(res, 200, await adoptVideo(args.id, args.jobId, readJob))
      if (args.action === 'removeAsset') {
        await updateProject(args.id, p => {
          if (!p.assets.some(a => a.id === args.assetId)) throw fail('素材不存在', 404)
          p.assets = p.assets.filter(a => a.id !== args.assetId)
        })
        return json(res, 200, { removed: true })
      }
      throw fail('未知操作')
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 503, { error: error.status ? error.message : '项目操作失败，请稍后重试' })
      else res.destroy()
    }
  }
}
export function registerProjectRoutes(ctx) {
  const token = randomBytes(32).toString('hex')
  const handler = createProjectsHandler({ token, ensureSession: async project => {
    const request = payload => ({ rpcId: randomUUID(), payload })
    const result = await ctx.apiProxy.sessions.create(request({ sessionId: project.sessionId, cwd: projectDirectory(project.id), agentPreset: 'elysium' }))
    if (!result.result.ok) throw fail(result.result.error.message, 409)
    const renamed = await ctx.apiProxy.sessions.rename(request({ sessionId: project.sessionId, title: project.name }))
    if (!renamed.result.ok) throw fail(renamed.result.error.message, 409)
  } })
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'global', name: '__ELYSIUM_PROJECTS__', value: { token, base: PROJECT_ROUTE } }))
  for (const suffix of ['', '/asset', '/file']) ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${PROJECT_ROUTE}${suffix}`, handler }), `elysium projects ${suffix}`)
}
