import { withConfig } from '../config.js'
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
    comfyui_view_url: job.result?.comfyui_view_url,
    media_kind: image ? 'image' : 'video',
    has_image: job.status === 'succeeded' && image && Boolean(job.result?.comfyui_view_url),
    has_video: job.status === 'succeeded' && Boolean(job.result?.comfyui_view_url) && !image }
}
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
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
      const summary = jobSummary(job)
      if (!(url.pathname === `${MEDIA_ROUTE}/video` && summary.has_video || url.pathname === `${MEDIA_ROUTE}/image` && summary.has_image)) return json(res, 404, { error: '媒体尚不可用' })
      const target = new URL(job.result.comfyui_view_url)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return json(res, 403, { error: 'Invalid media URL' })
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
  for (const suffix of ['status', 'video', 'image', 'credentials']) ctx.effect(() => server.register({ kind: 'exact', path: `${MEDIA_ROUTE}/${suffix}`, handler }), `elysium media ${suffix}`)
}
