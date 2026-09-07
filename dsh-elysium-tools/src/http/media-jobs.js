import { randomBytes, timingSafeEqual } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { extname, relative, isAbsolute } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getJob } from '../functions/common/task.js'
import { findVideoCall } from '../jobs/call-index.js'

export const MEDIA_ROUTE = '/plugins/dsh-elysium/media'
export function byteRange(header, size) {
  if (header === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid Range')
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw new Error('Invalid Range')
  return { start, end }
}
export function jobSummary(job) {
  return { job_id: job.job_id, status: job.status,
    stage: job.status === 'failed' ? job.failed_stage : job.workflow?.stage || job.stage,
    error: job.error, retryable: job.retryable, retry_scope: job.retry_scope,
    media_info: job.result?.media_info, validation: job.result?.validation,
    comfyui_view_url: job.result?.comfyui_view_url,
    has_video: job.status === 'succeeded' && Boolean(job.result?.path) }
}
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
export function createMediaHandler({ token, readJob = getJob, findCall = findVideoCall, getSession = () => undefined,
  artifactsRoot = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects' }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const supplied = Buffer.from(url.searchParams.get('t') || '')
      const expected = Buffer.from(token)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      const sessionId = url.searchParams.get('session'), callId = url.searchParams.get('call')
      if (!sessionId || sessionId.length > 256 || !callId || callId.length > 256) return json(res, 400, { error: 'Invalid call identity' })
      const id = await findCall(sessionId, callId, getSession(sessionId))
      if (!id) return json(res, 200, { status: 'pending', has_video: false })
      let job
      try { job = await readJob(id) } catch (error) {
        if (error.code === 'MODEL_JOB_NOT_FOUND') return json(res, 200, { status: 'pending', has_video: false })
        throw error
      }
      if (url.pathname === `${MEDIA_ROUTE}/status`) return json(res, 200, jobSummary(job))
      if (url.pathname !== `${MEDIA_ROUTE}/video` || job.status !== 'succeeded' || !job.result?.path) return json(res, 404, { error: '成片尚不可用' })
      const root = await realpath(artifactsRoot), path = await realpath(job.result.path)
      const rel = relative(root, path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || extname(path).toLowerCase() !== '.mp4') return json(res, 403, { error: 'Invalid artifact' })
      const handle = await open(path, 'r')
      try {
        const stat = await handle.stat()
        if (!stat.isFile()) return json(res, 404, { error: 'Not a file' })
        let range
        try { range = byteRange(req.headers.range, stat.size) } catch {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return
        }
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Length': range ? range.end - range.start + 1 : stat.size }
        if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
        if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = 'attachment; filename="video.mp4"'
        res.writeHead(range ? 206 : 200, headers)
        if (req.method === 'HEAD') res.end()
        else await pipeline(handle.createReadStream({ ...range, autoClose: false }), res)
      } finally { await handle.close() }
    } catch {
      if (!res.headersSent) json(res, 503, { error: '暂时无法读取任务，请稍后重试' })
      else res.destroy()
    }
  }
}
export function registerMediaRoutes(ctx) {
  const server = ctx.get?.('webServer')
  if (!server) return // CLI tools do not require a Web server.
  const token = randomBytes(32).toString('hex')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'global', name: '__ELYSIUM_MEDIA__', value: { token, base: MEDIA_ROUTE } }))
  const handler = createMediaHandler({ token, getSession: id => ctx.get('sessions')?.get(id) })
  for (const suffix of ['status', 'video']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
}
