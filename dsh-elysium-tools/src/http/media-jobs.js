import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig, withConfig } from '../config.js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { getJob } from '../jobs/query.js'
import { findVideoCall } from '../jobs/call-index.js'

export const MEDIA_ROUTE = '/plugins/dsh-elysium/media'
export function jobSummary(job) {
  const image = job.result?.media_kind === 'image' || job.capability === 'image-generate' || ['image-generate', 'image-compose'].includes(job.debug?.effective_input?.capability)
  return { job_id: job.job_id, status: job.status,
    stage: job.status === 'failed' ? job.failed_stage : job.workflow?.stage || job.stage,
    error_code: job.error_code, remote_status: job.remote_status,
    error: job.error, retryable: job.retryable, retry_scope: job.retry_scope,
    media_info: job.result?.media_info, validation: job.result?.validation,
    timings: job.timings, profile: job.result?.profile, specification: job.result?.specification,
    comfyui_view_url: job.result?.comfyui_view_url,
    media_kind: image ? 'image' : 'video',
    has_image: job.status === 'succeeded' && image && Boolean(job.result?.comfyui_view_url),
    has_video: job.status === 'succeeded' && Boolean(job.result?.comfyui_view_url) && !image }
}
export const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
export async function listAssets(offset, limit) {
  const root = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs')
  const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
    const path = join(root, entry.name, 'status.json')
    try {
      const job = JSON.parse(await readFile(path, 'utf8'))
      if (job.status === 'succeeded') items.push({ ...jobSummary(job), created_at: (await stat(path)).mtimeMs })
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  }
  items.sort((a, b) => b.created_at - a.created_at || a.job_id.localeCompare(b.job_id))
  return { items: items.slice(offset, offset + limit), total: items.length, has_more: offset + limit < items.length }
}
export function authenticated(url, token) {
  const supplied = Buffer.from(url.searchParams.get('t') || ''), expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
export function createMediaHandler({ token, readJob = getJob, findCall = findVideoCall, getSession = () => undefined }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === `${MEDIA_ROUTE}/credentials`) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
        // A custom header requires CORS preflight; this route never grants CORS access.
        if (req.headers['x-elysium-media-refresh'] !== '1' ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return json(res, 403, { error: 'Same-origin request required' })
        return json(res, 200, { token, base: MEDIA_ROUTE })
      }
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      if (url.pathname === `${MEDIA_ROUTE}/list`) {
        const limit = Number(url.searchParams.get('limit') ?? 50), offset = Number(url.searchParams.get('offset') ?? 0)
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: 'Invalid pagination' })
        return json(res, 200, await listAssets(offset, Math.min(limit, 200)))
      }
      const jobId = url.searchParams.get('job')
      if (jobId !== null && !/^[a-f0-9]{32}$/.test(jobId)) return json(res, 400, { error: 'Invalid job identity' })
      const sessionId = url.searchParams.get('session'), callId = url.searchParams.get('call')
      if (!jobId && (!sessionId || sessionId.length > 256 || !callId || callId.length > 256)) return json(res, 400, { error: 'Invalid call identity' })
      const id = jobId || await findCall(sessionId, callId, getSession(sessionId))
      const missing = () => url.pathname === `${MEDIA_ROUTE}/status` && !jobId
        ? json(res, 200, { status: 'pending', has_video: false }) : json(res, 404, { error: '媒体尚不可用' })
      if (!id) return missing()
      let job
      try { job = await readJob(id) } catch (error) {
        if (error.code === 'MODEL_JOB_NOT_FOUND') return missing()
        throw error
      }
      if (url.pathname === `${MEDIA_ROUTE}/status`) return json(res, 200, jobSummary(job))
      const summary = jobSummary(job)
      const download = url.pathname === `${MEDIA_ROUTE}/download`
      if (!(download && (summary.has_video || summary.has_image) || url.pathname === `${MEDIA_ROUTE}/video` && summary.has_video || url.pathname === `${MEDIA_ROUTE}/image` && summary.has_image)) return json(res, 404, { error: '媒体尚不可用' })
      const target = new URL(job.result.comfyui_view_url)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return json(res, 403, { error: 'Invalid media URL' })
      if (download) {
        const upstream = await fetch(target, { method: req.method, signal: AbortSignal.timeout(120_000) })
        if (!upstream.ok) { await upstream.body?.cancel(); return json(res, 502, { error: '媒体下载失败，请稍后重试' }) }
        const headers = { 'Content-Disposition': `attachment; filename="elysium-${job.job_id}.${summary.media_kind === 'image' ? 'png' : 'mp4'}"`,
          'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' }
        if (upstream.headers.has('content-length') && !upstream.headers.has('content-encoding')) headers['Content-Length'] = upstream.headers.get('content-length')
        res.writeHead(200, headers)
        if (req.method === 'HEAD' || !upstream.body) return res.end()
        await pipeline(Readable.fromWeb(upstream.body), res)
        return
      }
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' })
      res.end()
    } catch {
      if (!res.headersSent) json(res, 503, { error: '暂时无法读取任务，请稍后重试' })
      else res.destroy()
    }
  }
}
export function registerMediaRoutes(ctx, runtime) {
  const server = ctx.get?.('webServer')
  if (!server) return // CLI tools do not require a Web server.
  const token = randomBytes(32).toString('hex')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'global', name: '__ELYSIUM_MEDIA__', value: { token, base: MEDIA_ROUTE } }))
  const handle = createMediaHandler({ token, getSession: id => ctx.get('sessions')?.get(id) })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of ['status', 'video', 'image', 'credentials', 'download', 'list']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
  return token
}
