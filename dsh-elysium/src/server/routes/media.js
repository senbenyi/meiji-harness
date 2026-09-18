// 职责：提供素材列表、任务状态、媒体预览与下载的同源 HTTP 路由。
import { connectBackend } from '../../models/managers/runtime/index.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { withConfig } from '../../config.js'
import { randomBytes } from 'node:crypto'
import { getJob } from '../jobs/query.js'
import { findVideoCall } from '../workflows/videos/call-binding.js'
import { openLocalMedia, byteRange } from '../media/local-media.js'
import { jobSummary, availableJobSummary, listAssets, deleteAsset, uploadAsset } from '../media/catalog.js'
import { addMaterial, updateMaterial } from '../../database/managers/materials.js'
import { materialCategories } from '../../database/schemas/materials.js'
import { authenticated, json, readJsonBody } from '../http.js'

export const MEDIA_ROUTE = '/plugins/dsh-elysium/media'
export function createMediaHandler({ token, projectBase, directorBase, settingsBase, readJob = getJob, findCall = findVideoCall, getSession = () => undefined }) {
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
      if (['create', 'update'].some(action => url.pathname === `${MEDIA_ROUTE}/${action}`)) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        const body = await readJsonBody(req)
        if (!materialCategories.includes(body.category) || typeof body.title !== 'string' || !body.title.trim()) return json(res, 400, { error: '请填写素材名称并选择分类' })
        if (url.pathname.endsWith('/update')) return json(res, 200, await updateMaterial(body.id, body))
        const { title, description, prompt, category } = body
        return json(res, 201, await addMaterial({ title, description, prompt, category, source: 'creation', created_at: Date.now() }))
      }
      if (url.pathname === `${MEDIA_ROUTE}/delete`) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        const jobId = url.searchParams.get('id') || url.searchParams.get('job')
        if (!/^[a-f0-9]{32}$/.test(jobId || '')) return json(res, 400, { error: 'Invalid job identity' })
        return json(res, 200, await deleteAsset(jobId))
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
      if (url.pathname === `${MEDIA_ROUTE}/list`) {
        const limit = Number(url.searchParams.get('limit') ?? 50), offset = Number(url.searchParams.get('offset') ?? 0)
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: 'Invalid pagination' })
        const q = (url.searchParams.get('q') || '').trim()
        if (q.length > 200) return json(res, 400, { error: '搜索内容最多 200 字' })
        const profile = url.searchParams.get('profile') || '', media_kind = url.searchParams.get('media_kind') || ''
        const source = url.searchParams.get('source') || ''
        const category = url.searchParams.get('category') || ''
        if (category && !materialCategories.includes(category)) return json(res, 400, { error: 'Invalid category' })
        if (source && !['creation', 'project', 'import'].includes(source)) return json(res, 400, { error: 'Invalid source' })
        if (profile && !['preview', 'regular', 'high-quality', 'hd'].includes(profile) || media_kind && !['video', 'image', 'text'].includes(media_kind)) return json(res, 400, { error: 'Invalid filters' })
        return json(res, 200, await listAssets(offset, Math.min(limit, 200), { profile, media_kind, q, source, category }))
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
      if (url.pathname === `${MEDIA_ROUTE}/status`) return json(res, 200, await availableJobSummary(job))
      const summary = jobSummary(job)
      const download = url.pathname === `${MEDIA_ROUTE}/download`
      if (!(download && summary.has_download || url.pathname === `${MEDIA_ROUTE}/video` && summary.has_video || url.pathname === `${MEDIA_ROUTE}/image` && summary.has_image)) return json(res, 404, { error: '媒体尚不可用' })
      if (job.result?.local_media_path !== undefined) {
        const media = await openLocalMedia(job)
        try {
          const headers = { 'Content-Type': media.contentType, 'Content-Length': media.size, 'Accept-Ranges': 'bytes', 'ETag': media.etag, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
          if (download) headers['Content-Disposition'] = `attachment; filename="${media.path.split('/').at(-1)}"`
          const range = req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === media.etag) ? byteRange(req.headers.range, media.size) : undefined
          if (range === null) { res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${media.size}` }); return res.end() }
          if (range) { headers['Content-Range'] = `bytes ${range.first}-${range.last}/${media.size}`; headers['Content-Length'] = range.last - range.first + 1 }
          res.writeHead(range ? 206 : 200, headers)
          if (req.method === 'HEAD' || !media.size) return res.end()
          await pipeline(media.handle.createReadStream({ autoClose: false, ...(range ? { start: range.first, end: range.last } : {}) }), res)
          return
        } finally { await media.handle.close() }
      }
      const target = new URL(job.result.comfyui_view_url)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return json(res, 403, { error: 'Invalid media URL' })
      if (job.server) {
        const original = new URL(job.server.base_url.replace(/\/?$/, '/'))
        if (target.origin !== original.origin || target.pathname !== new URL('view', original).pathname) return json(res, 403, { error: '素材与原任务服务器不一致' })
        await connectBackend(job.server)
      }
      // ComfyUI 在服务器端编码轻量预览，原图和下载仍使用原始文件。
      if (url.pathname === `${MEDIA_ROUTE}/image` && url.searchParams.get('preview') === '1' && job.backend === 'comfyui') target.searchParams.set('preview', 'webp;75')
      const requestHeaders = { 'Accept-Encoding': 'identity' }, controller = new AbortController()
      const abortUpstream = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', abortUpstream)
      try {
        if (!download && req.headers.range) requestHeaders.Range = req.headers.range
        if (!download && req.headers['if-range']) requestHeaders['If-Range'] = req.headers['if-range']
        const upstream = await fetch(target, { method: req.method, headers: requestHeaders, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
        if (!upstream.ok && upstream.status !== 416) { await upstream.body?.cancel(); return json(res, 502, { error: '媒体读取失败，请稍后重试' }) }
        const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' }
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
  for (const suffix of ['status', 'video', 'image', 'credentials', 'download', 'list', 'delete', 'upload', 'create', 'update']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
  return token
}
