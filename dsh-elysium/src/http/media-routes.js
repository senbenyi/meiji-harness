// 职责：提供素材列表、任务状态、媒体预览与下载的同源 HTTP 路由。
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { withConfig } from '../config.js'
import { randomBytes } from 'node:crypto'
import { getJob } from '../jobs/query.js'
import { findVideoCall } from '../video/call-binding.js'
import { jobSummary, listAssets } from '../assets/catalog.js'
import { authenticated, json } from './shared.js'

export const MEDIA_ROUTE = '/plugins/dsh-elysium/media'
export function createMediaHandler({ token, projectBase, readJob = getJob, findCall = findVideoCall, getSession = () => undefined }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === `${MEDIA_ROUTE}/credentials`) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
        // A custom header requires CORS preflight; this route never grants CORS access.
        if (req.headers['x-elysium-media-refresh'] !== '1' ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return json(res, 403, { error: 'Same-origin request required' })
        return json(res, 200, { token, base: MEDIA_ROUTE, projectBase })
      }
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      if (url.pathname === `${MEDIA_ROUTE}/list`) {
        const limit = Number(url.searchParams.get('limit') ?? 50), offset = Number(url.searchParams.get('offset') ?? 0)
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: 'Invalid pagination' })
        const q = (url.searchParams.get('q') || '').trim()
        if (q.length > 200) return json(res, 400, { error: '搜索内容最多 200 字' })
        const profile = url.searchParams.get('profile') || '', media_kind = url.searchParams.get('media_kind') || ''
        if (profile && !['preview', 'regular', 'high-quality', 'hd'].includes(profile) || media_kind && !['video', 'image'].includes(media_kind)) return json(res, 400, { error: 'Invalid filters' })
        return json(res, 200, await listAssets(offset, Math.min(limit, 200), { profile, media_kind, q }))
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
      const requestHeaders = { 'Accept-Encoding': 'identity' }
      if (!download && req.headers.range) requestHeaders.Range = req.headers.range
      if (!download && req.headers['if-range']) requestHeaders['If-Range'] = req.headers['if-range']
      const upstream = await fetch(target, { method: req.method, headers: requestHeaders, signal: AbortSignal.timeout(120_000) })
      if (!upstream.ok && upstream.status !== 416) { await upstream.body?.cancel(); return json(res, 502, { error: '媒体读取失败，请稍后重试' }) }
      const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' }
      if (download) headers['Content-Disposition'] = `attachment; filename="elysium-${job.job_id}.${summary.media_kind === 'image' ? 'png' : 'mp4'}"`
      for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        if (upstream.headers.has(name) && !(name === 'content-length' && upstream.headers.has('content-encoding'))) headers[name] = upstream.headers.get(name)
      }
      res.writeHead(upstream.status, headers)
      if (req.method === 'HEAD' || !upstream.body) return res.end()
      await pipeline(Readable.fromWeb(upstream.body), res)
    } catch {
      if (!res.headersSent) json(res, 503, { error: '暂时无法读取任务，请稍后重试' })
      else res.destroy()
    }
  }
}
export function registerMediaRoutes(ctx, runtime, projectBase) {
  const server = ctx.get?.('webServer')
  if (!server) return // CLI tools do not require a Web server.
  const token = randomBytes(32).toString('hex')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'global', name: '__ELYSIUM_MEDIA__', value: { token, base: MEDIA_ROUTE, projectBase } }))
  const handle = createMediaHandler({ token, projectBase, getSession: id => ctx.get('sessions')?.get(id) })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of ['status', 'video', 'image', 'credentials', 'download', 'list']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
  return token
}
