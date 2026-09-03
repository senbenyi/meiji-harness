import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  projectCreate,
  projectDelete,
  projectGet,
  projectList,
} from './lib/project.js'
import { planGet, planUpdateShot } from './lib/plan.js'
import { createGenerationService } from './lib/generate.js'
import { registerUploadedImage } from './lib/assets.js'
import { updateCharacterRecord, updateShotRecord } from './lib/shot.js'
import { ElysiumError, resolveProjectFile } from './lib/store.js'
import { createFactoryService, FACTORY_TOOL, serveFactoryArtifact } from './lib/factory.js'
import { createComfyUiService } from './comfyui/service.js'
import { episodeCreate, episodeGet, episodeList, episodeUpdate } from './lib/episodes.js'
import { createProductionService } from './lib/production.js'

export const name = '@dsh-external/dsh-elysium'
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
    if (size > 1024 * 1024) throw new ElysiumError('BODY_TOO_LARGE', 'Request body is too large', 413)
    chunks.push(Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new ElysiumError('INVALID_JSON', 'Request body must be valid JSON')
  }
}

async function readUpload(req) {
  const declared = Number(req.headers?.['content-length'] || 0)
  if (declared > 25 * 1024 * 1024) throw new ElysiumError('UPLOAD_TOO_LARGE', 'Image must be 25 MB or smaller', 413)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 25 * 1024 * 1024) throw new ElysiumError('UPLOAD_TOO_LARGE', 'Image must be 25 MB or smaller', 413)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
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

function attachRoutes(ctx, config, generation, factory, production, comfy, fence) {
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
    ['/factory.execute', (_config, body) => factory.execute(body)],
    ['/episode.list', episodeList],
    ['/episode.create', episodeCreate],
    ['/episode.get', episodeGet],
    ['/episode.update', episodeUpdate],
    ['/production.start', (_config, body) => production.start(body)],
    ['/production.pause', (_config, body) => production.pause(body)],
    ['/production.resume', (_config, body) => production.resume(body)],
    ['/production.status', (_config, body) => production.status(body)],
    ['/production.retry', (_config, body) => production.retry(body)],
    ['/artifact.adopt', (_config, body) => production.adopt(body)],
    ['/issue.resolve', (_config, body) => production.resolveIssue(body)],
    ['/review.approve', (_config, body) => production.approve(body)],
    ['/comfyui.state', () => comfy.state()],
    ['/comfyui.save', (_config, body) => comfy.saveSettings(body)],
    ['/comfyui.inspect', (_config, body) => comfy.inspect(body.template, body.query)],
    ['/comfyui.scan', (_config, body) => comfy.scan(body)],
    ['/comfyui.import', (_config, body) => comfy.importTemplate(body)],
    ['/comfyui.remove_template', (_config, body) => comfy.removeTemplate(body.id)],
    ['/comfyui.register_lora', (_config, body) => comfy.registerLora(body)],
    ['/comfyui.remove_lora', (_config, body) => comfy.removeLora(body.name)],
  ])

  const disposeApi = ctx.webServer.register({
    kind: 'prefix',
    path: '/elysium/api',
    handler: async (req, res) => {
      if (!fence(req)) return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Request origin is not trusted' })
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' })
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const sub = pathname.replace(/^\/elysium\/api/, '') || '/'
      const handler = routes.get(sub)
      if (!handler) return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: `Unknown route: ${sub}` })
      try {
        return sendJson(res, 200, await handler(config, await readBody(req)))
      } catch (error) {
        ctx.logger?.warn?.(`[elysium] ${sub}: ${error?.message || error}`)
        return sendError(res, error)
      }
    },
  })

  const disposeFile = ctx.webServer.register({
    kind: 'prefix',
    path: '/elysium/file',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end('Request origin is not trusted')
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        return res.end()
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const file = await resolveProjectFile(config, url.searchParams.get('project'), url.searchParams.get('path'))
        const type = MEDIA_TYPES.get(path.extname(file).toLowerCase())
        if (!type) throw new ElysiumError('UNSUPPORTED_MEDIA', 'Unsupported media type', 415)
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

  const disposeFactoryFile = ctx.webServer.register({
    kind: 'prefix',
    path: '/elysium/factory-file',
    handler: async (req, res) => {
      if (!fence(req)) return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Request origin is not trusted' })
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' })
      return serveFactoryArtifact(req, res, config)
    },
  })

  const disposeImport = ctx.webServer.register({
    kind: 'prefix',
    path: '/elysium/import-image',
    handler: async (req, res) => {
      if (!fence(req)) return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Request origin is not trusted' })
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const projectId = url.searchParams.get('projectId')
        const scope = url.searchParams.get('scope')
        const entityId = url.searchParams.get('entityId')
        const filename = url.searchParams.get('filename')
        const bytes = await readUpload(req)
        const result = scope === 'characters'
          ? await updateCharacterRecord(config, projectId, entityId, async character => {
            const imagePath = await registerUploadedImage(config, {
              projectId, scope, entityId, filename, bytes,
            })
            return { ...character, imagePath, imageStatus: 'image_ready', imageJobId: null, lastError: null }
          })
          : await updateShotRecord(config, projectId, entityId, async shot => {
            const imagePath = await registerUploadedImage(config, {
              projectId, scope, entityId, filename, bytes,
            })
            return {
              ...shot,
              imagePath,
              videoPath: null,
              status: 'image_ready',
              imageJobId: null,
              videoJobId: null,
              failedStage: null,
              lastError: null,
            }
          })
        return sendJson(res, 200, result)
      } catch (error) {
        ctx.logger?.warn?.(`[elysium] import-image: ${error?.message || error}`)
        return sendError(res, error)
      }
    },
  })

  return () => {
    disposeImport?.()
    disposeFactoryFile?.()
    disposeFile?.()
    disposeApi?.()
  }
}

export function apply(ctx, config = {}, fence = (_request) => false) {
  const comfy = createComfyUiService(config)
  const generation = createGenerationService(ctx, config, comfy)
  const factory = createFactoryService(ctx, config, comfy)
  const production = createProductionService(ctx, config, comfy)
  const register = (scope) => scope.effect(
    () => {
      const disposeRoutes = attachRoutes(scope, config, generation, factory, production, comfy, fence)
      void production.resumeAll().catch(error => scope.logger?.warn?.(`[elysium] production recovery: ${error?.message || error}`))
      return () => {
        generation.dispose()
        production.dispose()
        disposeRoutes()
      }
    },
    '@dsh-external/dsh-elysium: routes',
  )
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], register)
  } else {
    const webServer = ctx.get?.('webServer')
    if (webServer) register(ctx)
  }
  const factoryTool = defineTool({
    name: FACTORY_TOOL,
    description: '极乐世界短剧生产工具。创建项目单集、保存动态六锚点规划、自动生产、恢复、精确重试、查询状态和人工验收。旧 VMP 生产单继续兼容。',
    parameters: {
      action: { type: 'string', required: true, description: '旧流程：list/create/check/status/run/job/retry/artifact/approve；新流程：episode_create/episode_list/episode_get/episode_update/production_start/production_pause/production_resume/production_status/production_retry/review_approve' },
      spec: { type: 'string', description: '生产单文件名，如 beach-story.json' },
      episode: { type: 'object', additionalProperties: true, description: 'create 使用的完整 vmp-1 生产单，必须正好包含 shot-01 和 shot-02' },
      stage: { type: 'string', description: 'run 使用：images | video | final | all' },
      job_id: { type: 'string', description: 'job 使用的本机任务 ID' },
      episode_id: { type: 'string', description: 'sync 使用的单集 ID' },
      artifact: { type: 'string', description: 'sync 使用：final | qc | review' },
      target: { type: 'string', description: 'retry 使用：shot-01 | shot-02 | block-01 | block-02 | final' },
      confirm_authorized_adults: { type: 'boolean', description: '付费图片/视频生成前必须为 true' },
      reviewer: { type: 'string', description: 'approve 使用的审核人标识' },
      confirm_human_review_passed: { type: 'boolean', description: '完整观看成片并确认通过后才可为 true' },
      projectId: { type: 'string', description: '新流程项目 ID' },
      episodeId: { type: 'string', description: '新流程单集 ID' },
      title: { type: 'string', description: '单集标题' },
      sourceText: { type: 'string', description: '故事原文或想法' },
      targetDurationSec: { type: 'number', description: '目标时长，20 到 600 秒' },
      profile: { type: 'string', description: 'preview 或 final' },
      budget: { type: 'number', description: '生产预算' },
      stylePrompt: { type: 'string', description: '统一画面风格' },
      castPrompt: { type: 'string', description: '统一人物设定' },
      negativePrompt: { type: 'string', description: '负面提示词' },
      plan: { type: 'object', additionalProperties: true, description: '动态章节规划；每章正好六个锚点' },
      updates: { type: 'object', additionalProperties: true, description: '单集更新字段' },
      taskId: { type: 'string', description: '精确重试的任务 ID' },
      issueId: { type: 'string', description: '待处理问题 ID' },
      path: { type: 'string', description: '要采用的历史产物路径' },
      resolution: { type: 'string', description: '问题处理方式，当前支持 retry' },
      confirmAuthorizedContent: { type: 'boolean', description: '本次单集付费生成授权' },
      confirmHumanReviewPassed: { type: 'boolean', description: '新流程人工终审确认' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      try {
        const input = args || {}
        const handlers = {
          episode_create: () => episodeCreate(config, input),
          episode_list: () => episodeList(config, input),
          episode_get: () => episodeGet(config, input),
          episode_update: () => episodeUpdate(config, input),
          production_start: () => production.start(input),
          production_pause: () => production.pause(input),
          production_resume: () => production.resume(input),
          production_status: () => production.status(input),
          production_retry: () => production.retry(input),
          artifact_adopt: () => production.adopt(input),
          issue_resolve: () => production.resolveIssue(input),
          review_approve: () => production.approve(input),
        }
        const handler = handlers[input.action]
        return JSON.stringify(await (handler ? handler() : factory.execute(input)), null, 2)
      } catch (error) {
        return JSON.stringify({ ok: false, code: error?.code || 'FACTORY_ERROR', message: error?.message || String(error) }, null, 2)
      }
    },
  })
  if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
    ctx.effect(() => ctx.tools.register(factoryTool), '@dsh-external/dsh-elysium: factory tool')
  } else if (typeof ctx.tools?.register === 'function') {
    ctx.tools.register(factoryTool)
  }
  ctx.logger?.info?.('[elysium] AI short-drama factory API and chat tool loaded')
}
