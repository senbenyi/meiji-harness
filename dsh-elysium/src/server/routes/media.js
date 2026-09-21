// 职责：提供素材列表、任务状态、媒体预览与下载的同源 HTTP 路由。
import { closeLocalMedia, connectBackend, findJobCall, getJob, jobSummary, openLocalMedia, openLocalPreview, openRemotePreview, retryTask, streamLocalMedia } from '../../worker/index.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { withConfig } from '../../config.js'
import { mediaSession } from '../../session/index.js'
import { randomBytes } from 'node:crypto'
import { availableJobSummary, listAssets, deleteAsset, uploadAsset } from '../media/catalog.js'
import { authenticated, byteRange, json } from '../http.js'

export const MEDIA_ROUTE = '/plugins/dsh-elysium/media'
async function serveStoredMedia(req, res, media, filename) {
  const headers = { 'Content-Type': media.contentType, 'Content-Length': media.size, 'Accept-Ranges': 'bytes', 'ETag': media.etag,
    'Cache-Control': filename ? 'no-store' : 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`
  const range = req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === media.etag) ? byteRange(req.headers.range, media.size) : undefined
  if (range === null) { res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${media.size}` }); return res.end() }
  if (range) { headers['Content-Range'] = `bytes ${range.first}-${range.last}/${media.size}`; headers['Content-Length'] = range.last - range.first + 1 }
  res.writeHead(range ? 206 : 200, headers)
  if (req.method === 'HEAD' || !media.size) return res.end()
  await pipeline(streamLocalMedia(media, range ? { start: range.first, end: range.last } : {}), res)
}
export function createMediaHandler({ token, projectBase, directorBase, settingsBase, readJob = getJob, findCall = findJobCall, retryJob = id => retryTask(id, { consent: true }), getSession = () => undefined }) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === `${MEDIA_ROUTE}/credentials`) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
        // A custom header requires CORS preflight; this route never grants CORS access.
        if (req.headers['x-elysium-media-refresh'] !== '1' ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return json(res, 403, { error: 'Same-origin request required' })
        return json(res, 200, { token, base: MEDIA_ROUTE, projectBase, directorBase, settingsBase })
      }
      if (!authenticated(url, token)) return json(res, 401, { error: '页面凭据已失效，请刷新页面' })
      if (url.pathname === `${MEDIA_ROUTE}/upload`) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        return json(res, 201, await uploadAsset(req, url.searchParams.get('filename')))
      }
      if (url.pathname === `${MEDIA_ROUTE}/delete`) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        const jobId = url.searchParams.get('job')
        if (!/^[a-f0-9]{32}$/.test(jobId || '')) return json(res, 400, { error: 'Invalid job identity' })
        return json(res, 200, await deleteAsset(jobId))
      }
      // 工作卡人工重试：按会话调用定位原任务，点击即视为用户同意；只启动恢复，不等待完成。
      if (url.pathname === `${MEDIA_ROUTE}/retry`) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        const sessionId = url.searchParams.get('session'), callId = url.searchParams.get('call')
        if (!sessionId || sessionId.length > 256 || !callId || callId.length > 256) return json(res, 400, { error: 'Invalid call identity' })
        const id = await findCall(sessionId, callId, mediaSession(getSession(sessionId)))
        if (!id) return json(res, 404, { error: '没有可重试的任务' })
        return json(res, 202, await retryJob(id))
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      if (url.pathname === `${MEDIA_ROUTE}/list`) {
        const limit = Number(url.searchParams.get('limit') ?? 50), offset = Number(url.searchParams.get('offset') ?? 0)
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: 'Invalid pagination' })
        const q = (url.searchParams.get('q') || '').trim()
        if (q.length > 200) return json(res, 400, { error: '搜索内容最多 200 字' })
        const profile = url.searchParams.get('profile') || '', media_kind = url.searchParams.get('media_kind') || ''
        const source = url.searchParams.get('source') || ''
        if (source && !['creation', 'project', 'import'].includes(source)) return json(res, 400, { error: 'Invalid source' })
        if (profile && !['preview', 'regular', 'high-quality', 'hd'].includes(profile) || media_kind && !['video', 'image'].includes(media_kind)) return json(res, 400, { error: 'Invalid filters' })
        return json(res, 200, await listAssets(offset, Math.min(limit, 200), { profile, media_kind, q, source }))
      }
      const jobId = url.searchParams.get('job')
      if (jobId !== null && !/^[a-f0-9]{32}$/.test(jobId)) return json(res, 400, { error: 'Invalid job identity' })
      const sessionId = url.searchParams.get('session'), callId = url.searchParams.get('call')
      if (!jobId && (!sessionId || sessionId.length > 256 || !callId || callId.length > 256)) return json(res, 400, { error: 'Invalid call identity' })
      const id = jobId || await findCall(sessionId, callId, mediaSession(getSession(sessionId)))
      const missing = () => url.pathname === `${MEDIA_ROUTE}/status` && !jobId
        ? json(res, 200, { status: 'pending', has_video: false }) : json(res, 404, { error: '媒体尚不可用' })
      if (!id) return missing()
      let job
      try { job = await readJob(id) } catch (error) {
        if (error.code === 'MODEL_JOB_NOT_FOUND') return missing()
        throw error
      }
      if (url.pathname === `${MEDIA_ROUTE}/status`) return json(res, 200, await availableJobSummary(job))
      const summary = jobSummary(job)
      const download = url.pathname === `${MEDIA_ROUTE}/download`
      if (!(download && summary.has_download || url.pathname === `${MEDIA_ROUTE}/video` && summary.has_video || url.pathname === `${MEDIA_ROUTE}/image` && summary.has_image)) return json(res, 404, { error: '媒体尚不可用' })
      if (job.result?.local_media_path !== undefined && (download || !job.result.preview_view_url)) {
        const original = await openLocalMedia(job)
        let media = original
        try {
          if (!download) media = await openLocalPreview(job, original)
          return await serveStoredMedia(req, res, media, download ? original.path.split('/').at(-1) : null)
        } finally { if (media !== original) await closeLocalMedia(media); await closeLocalMedia(original) }
      }
      const target = new URL(job.result.comfyui_view_url)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return json(res, 403, { error: 'Invalid media URL' })
      if (job.server) {
        const original = new URL(job.server.base_url.replace(/\/?$/, '/'))
        if (target.origin !== original.origin || target.pathname !== new URL('view', original).pathname) return json(res, 403, { error: '素材与原任务服务器不一致' })
        await connectBackend(job.server)
      }
      if (url.pathname === `${MEDIA_ROUTE}/image`) target.searchParams.set('preview', 'webp;60')
      if (url.pathname === `${MEDIA_ROUTE}/video` && job.result.preview_view_url) {
        const preview = new URL(job.result.preview_view_url)
        if (preview.origin !== target.origin || preview.pathname !== target.pathname || preview.username || preview.password) return json(res, 403, { error: '视频预览与原任务服务器不一致' })
        target.href = preview.href
      }
      if (url.pathname === `${MEDIA_ROUTE}/video` && !job.result.preview_view_url) {
        const media = await openRemotePreview(job, target.href)
        try { return await serveStoredMedia(req, res, media, null) }
        finally { await closeLocalMedia(media) }
      }
      const requestHeaders = { 'Accept-Encoding': 'identity' }, controller = new AbortController()
      const abortUpstream = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', abortUpstream)
      try {
        if (!download && req.headers.range) requestHeaders.Range = req.headers.range
        if (!download && req.headers['if-range']) requestHeaders['If-Range'] = req.headers['if-range']
        const upstream = await fetch(target, { method: req.method, headers: requestHeaders, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
        if (!upstream.ok && upstream.status !== 416) { await upstream.body?.cancel(); return json(res, 502, { error: '媒体读取失败，请稍后重试' }) }
        const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
          'Cache-Control': download ? 'no-store' : 'private, max-age=86400' }
        if (download) headers['Content-Disposition'] = `attachment; filename="elysium-${job.job_id}.${summary.media_kind === 'image' ? 'png' : 'mp4'}"`
        for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          if (upstream.headers.has(name) && !(name === 'content-length' && upstream.headers.has('content-encoding'))) headers[name] = upstream.headers.get(name)
        }
        res.writeHead(upstream.status, headers)
        if (req.method === 'HEAD' || !upstream.body) return res.end()
        await pipeline(Readable.fromWeb(upstream.body), res)
      } finally { res.off('close', abortUpstream) }
    } catch (error) {
      if ((req.destroyed || res.destroyed) && (error.name === 'AbortError' || error.code === 'ERR_STREAM_PREMATURE_CLOSE')) return
      if (!res.headersSent && error.status) return json(res, error.status, { error: error.message })
      if (!res.headersSent) json(res, 503, { error: '暂时无法读取任务，请稍后重试' })
      else { console.error('[elysium] media stream interrupted:', error.message); res.destroy() }
    }
  }
}
export function registerMediaRoutes(ctx, runtime, projectBase, directorBase, settingsBase) {
  const server = ctx.get?.('webServer')
  if (!server) return // CLI tools do not require a Web server.
  const token = randomBytes(32).toString('hex')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'global', name: '__ELYSIUM_MEDIA__', value: { token, base: MEDIA_ROUTE, projectBase, directorBase, settingsBase } }))
  const handle = createMediaHandler({ token, projectBase, directorBase, settingsBase, getSession: id => ctx.get('sessions')?.get(id) })
  const handler = (req, res) => withConfig(runtime, () => handle(req, res))
  for (const suffix of ['status', 'video', 'image', 'credentials', 'download', 'list', 'delete', 'upload', 'retry']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
  return token
}
