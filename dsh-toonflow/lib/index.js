import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  projectCreate,
  projectDelete,
  projectGet,
  projectList,
} from './lib/project.js'
import { planGet, planUpdateShot } from './lib/plan.js'
import { createGenerationService } from './lib/generate.js'
import { ToonflowError, resolveProjectFile } from './lib/store.js'

export const name = '@dsh-external/dsh-toonflow'
export const inject = ['tools']

const MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
])

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new ToonflowError('BODY_TOO_LARGE', 'Request body is too large', 413)
    chunks.push(Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new ToonflowError('INVALID_JSON', 'Request body must be valid JSON')
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  sendJson(res, status, {
    ok: false,
    code: error?.code || 'INTERNAL_ERROR',
    error: status >= 500 ? 'Internal server error' : error.message,
  })
}

function attachRoutes(ctx, config, generation) {
  const routes = new Map([
    ['/project.list', projectList],
    ['/project.get', projectGet],
    ['/project.create', projectCreate],
    ['/project.delete', projectDelete],
    ['/plan.get', planGet],
    ['/plan.update_shot', planUpdateShot],
    ['/shot.batch_status', (_config, body) => generation.batchStatus(body.projectId)],
    ['/shot.generate_image', (_config, body) => generation.submitShotImage(body.projectId, body.shotId)],
    ['/shot.generate_video', (_config, body) => generation.submitShotVideo(body.projectId, body.shotId)],
    ['/shot.retry', (_config, body) => generation.retryShot(body.projectId, body.shotId)],
    ['/char.generate_image', (_config, body) => generation.submitCharacter(body.projectId, body.characterId)],
  ])

  const disposeApi = ctx.webServer.register({
    kind: 'prefix',
    path: '/toonflow/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' })
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const sub = pathname.replace(/^\/toonflow\/api/, '') || '/'
      const handler = routes.get(sub)
      if (!handler) return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: `Unknown route: ${sub}` })
      try {
        return sendJson(res, 200, await handler(config, await readBody(req)))
      } catch (error) {
        ctx.logger?.warn?.(`[toonflow] ${sub}: ${error?.message || error}`)
        return sendError(res, error)
      }
    },
  })

  const disposeFile = ctx.webServer.register({
    kind: 'prefix',
    path: '/toonflow/file',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        return res.end()
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const file = await resolveProjectFile(config, url.searchParams.get('project'), url.searchParams.get('path'))
        const type = MEDIA_TYPES.get(path.extname(file).toLowerCase())
        if (!type) throw new ToonflowError('UNSUPPORTED_MEDIA', 'Unsupported media type', 415)
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
        res.end(body)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(status >= 500 ? 'Internal server error' : error.message)
      }
    },
  })

  return () => {
    disposeFile?.()
    disposeApi?.()
  }
}

export function apply(ctx, config = {}) {
  const generation = createGenerationService(ctx, config)
  const register = (scope) => scope.effect(
    () => {
      const disposeRoutes = attachRoutes(scope, config, generation)
      return () => {
        generation.dispose()
        disposeRoutes()
      }
    },
    '@dsh-external/dsh-toonflow: routes',
  )
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], register)
  } else {
    const webServer = ctx.get?.('webServer')
    if (webServer) register(ctx)
  }
  ctx.logger?.info?.('[toonflow] Phase 3 — generation API loaded')
}
