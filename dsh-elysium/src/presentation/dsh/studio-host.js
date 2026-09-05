import * as path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  projectCreate,
  projectDelete,
  projectGet,
  projectList,
} from '../../application/project-service.js'
import { planGet, planUpdateShot } from '../../application/plan-service.js'
import { createGenerationService } from '../../application/generation-service.js'
import { registerUploadedImage } from '../../application/asset-service.js'
import { updateCharacterRecord, updateShotRecord } from '../../application/shot-service.js'
import { ElysiumError, resolveProjectFile } from '../../infrastructure/persistence/store.js'
import { createFactoryService, FACTORY_TOOL, serveFactoryArtifact } from '../../application/legacy-factory-service.js'
import { createComfyUiService } from '../../infrastructure/comfyui/service.js'
import { episodeCreate, episodeGet, episodeList, episodeUpdate } from '../../application/episode-service.js'
import { createProductionService } from '../../application/production-service.js'
import { createOnelineService } from '../../application/oneline-service.js'
import { createPlannerService } from '../../application/planning-service.js'
import { createCreationService } from '../../application/creation-service.js'
import { DIRECTORS_VERSION, listDirectors } from '../../application/directors.js'

export const name = '@dsh-external/dsh-elysium'
export const inject = ['tools', 'llm']

const MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
])

function byteRange(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim())
  if (!match || (!match[1] && !match[2])) throw new ElysiumError('INVALID_RANGE', 'Invalid byte range', 416)
  let start
  let end
  if (!match[1]) {
    const length = Number(match[2])
    if (!Number.isSafeInteger(length) || length <= 0) throw new ElysiumError('INVALID_RANGE', 'Invalid byte range', 416)
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new ElysiumError('INVALID_RANGE', 'Requested byte range is not satisfiable', 416)
  }
  return { start, end: Math.min(end, size - 1) }
}

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
  const safeMessage = {
    TIMEOUT: '连接 ComfyUI 超时，请检查服务状态、地址或 SSH 隧道后重试',
    HTTP_ERROR: '无法连接 ComfyUI，请检查服务地址和网络后重试',
    UNREACHABLE: 'ComfyUI 当前不可用，请检查服务后重试',
  }[error?.code]
  sendJson(res, status, {
    ok: false,
    code: error?.code || 'INTERNAL_ERROR',
    error: safeMessage || (status >= 500 ? 'Internal server error' : error.message),
  })
}

function hasSuppliedPlan(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.chapters))
}

async function createPlannedEpisode(config, planner, body) {
  // 调用方已经给出规划时不再重跑 Producer Agent：否则传入的 plan 会被 `{...body, ...planned}`
  // 静默覆盖，调用方拿到的是一份自己没要过的规划。
  if (hasSuppliedPlan(body.plan)) return episodeCreate(config, body)
  const planned = await planner.plan(body)
  return episodeCreate(config, { ...body, ...planned })
}

async function updatePlannedEpisode(config, planner, body) {
  const updates = body.updates && typeof body.updates === 'object' ? body.updates : {}
  const current = await episodeGet(config, body)
  // 同上：显式给了 plan 就以调用方的为准，除非明确要求 replan。
  if (hasSuppliedPlan(updates.plan) && body.replan !== true) return episodeUpdate(config, body)
  const needsReplan = body.replan === true
    || ['sourceText', 'targetDurationSec', 'stylePrompt', 'castPrompt', 'aspectRatio']
      .some(key => updates[key] !== undefined && updates[key] !== current.episode[key])
  if (!needsReplan) return episodeUpdate(config, body)
  const next = { ...current.episode, ...updates, episodeId: current.episode.id }
  const planned = await planner.plan(next)
  return episodeUpdate(config, { ...body, updates: { ...updates, ...planned } })
}

async function planSavedEpisode(config, planner, body) {
  const current = await episodeGet(config, body)
  const planned = await planner.plan({ ...current.episode, episodeId: current.episode.id })
  return episodeUpdate(config, { ...body, updates: planned })
}

function attachRoutes(ctx, config, generation, factory, production, planner, comfy, creation, oneline, fence) {
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
    ['/episode.plan', (_config, body) => planSavedEpisode(config, planner, body)],
    ['/production.start', (_config, body) => production.start(body)],
    ['/production.pause', (_config, body) => production.pause(body)],
    ['/production.resume', (_config, body) => production.resume(body)],
    ['/production.status', (_config, body) => production.status(body)],
    ['/production.retry', (_config, body) => production.retry(body)],
    ['/artifact.adopt', (_config, body) => production.adopt(body)],
    ['/issue.resolve', (_config, body) => production.resolveIssue(body)],
    ['/review.approve', (_config, body) => production.approve(body)],
    // 创新项目入口。approve_story / sync_to_production / reopen_story 只在这里暴露，
    // 不进聊天工具的 action 表——模型物理上无法自我批准或自行写入制作流程。
    ['/director.list', () => ({ ok: true, catalogVersion: DIRECTORS_VERSION, directors: listDirectors() })],
    ['/creation.create_project', (_config, body) => creation.createProject(body)],
    ['/creation.bind_session', (_config, body) => creation.bindSession(body)],
    ['/creation.get_state', (_config, body) => creation.getState(body)],
    ['/creation.save_step', (_config, body) => creation.saveStep(body)],
    ['/creation.confirm_step', (_config, body) => creation.confirmStep(body)],
    ['/creation.compile_story', (_config, body) => creation.compileStory(body)],
    ['/creation.approve_story', (_config, body) => creation.approveStory(body)],
    ['/creation.sync_to_production', (_config, body) => creation.syncToProduction(body)],
    ['/creation.reopen_story', (_config, body) => creation.reopenStory(body)],
    // 一句话入口。oneline.approve 只在这里暴露，不进聊天工具 action 表——
    // 人工终审必须由用户在界面上做，模型不能自我批准。
    ['/oneline.submit', (_config, body) => oneline.submit(body)],
    ['/oneline.authorize', (_config, body) => oneline.authorize(body)],
    ['/oneline.status', (_config, body) => oneline.status(body)],
    ['/oneline.redo', (_config, body) => oneline.redo(body)],
    ['/oneline.approve', (_config, body) => oneline.approve(body)],
    ['/comfyui.state', () => comfy.state()],
    ['/comfyui.transfer_stats', () => comfy.transferStats()],
    ['/comfyui.reset_transfer_stats', () => comfy.resetTransferStats()],
    ['/comfyui.test', (_config, body) => comfy.testConnection(body)],
    ['/comfyui.save', (_config, body) => comfy.saveSettings(body)],
    ['/comfyui.inspect', (_config, body) => comfy.inspect(body.template, body.query)],
    ['/comfyui.test_template', (_config, body) => comfy.testTemplate(body.template)],
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
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405)
        return res.end()
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const file = await resolveProjectFile(config, url.searchParams.get('project'), url.searchParams.get('path'))
        const type = MEDIA_TYPES.get(path.extname(file).toLowerCase())
        if (!type) throw new ElysiumError('UNSUPPORTED_MEDIA', 'Unsupported media type', 415)
        const size = (await stat(file)).size
        let range
        try { range = byteRange(req.headers?.range, size) }
        catch (error) {
          if (error?.status !== 416) throw error
          res.writeHead(416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' })
          return res.end()
        }
        const start = range?.start ?? 0
        const end = range?.end ?? Math.max(0, size - 1)
        const headers = {
          'content-type': type,
          'content-length': range ? end - start + 1 : size,
          'accept-ranges': 'bytes',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        }
        if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
        res.writeHead(range ? 206 : 200, headers)
        if (req.method === 'HEAD' || size === 0) return res.end()
        for await (const chunk of createReadStream(file, { start, end })) res.write(chunk)
        res.end()
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
  const comfy = createComfyUiService(config, ctx.llm || ctx.get?.('llm'))
  const generation = createGenerationService(ctx, config, comfy)
  const factory = createFactoryService(ctx, config, comfy)
  const production = createProductionService(ctx, config, comfy)
  const planner = createPlannerService(ctx, config)
  const creation = createCreationService(config, planner)
  const oneline = createOnelineService(config, planner, production)
  const register = (scope) => scope.effect(
    () => {
      const disposeRoutes = attachRoutes(scope, config, generation, factory, production, planner, comfy, creation, oneline, fence)
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
    description: '极乐世界单插件短剧生产工具。创建项目单集、规划、自动生产、恢复、精确重试、人工验收，以及内置 ComfyUI 的检查、生成、任务、模板和 LoRA 管理。',
    parameters: {
      action: { type: 'string', required: true, description: '短剧动作；一句话入口：oneline_submit/oneline_status/oneline_redo（授权与终审不在此处，必须由用户在界面完成）；内置驱动动作：comfyui_state/comfyui_inspect/comfyui_generate/comfyui_job/comfyui_scan/comfyui_import/comfyui_remove_template/comfyui_save/comfyui_register_lora/comfyui_remove_lora；旧 VMP 动作继续兼容' },
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
      targetDurationSec: { type: 'number', description: '目标时长，10 到 600 秒' },
      aspectRatio: { type: 'string', description: '画幅：9:16 或 16:9' },
      profile: { type: 'string', description: 'preview 或 final' },
      budget: { type: 'number', description: '生产预算' },
      stylePrompt: { type: 'string', description: '统一画面风格' },
      castPrompt: { type: 'string', description: '统一人物设定' },
      negativePrompt: { type: 'string', description: '负面提示词' },
      plan: { type: 'object', additionalProperties: true, description: '动态章节规划；每章正好六个锚点' },
      script: { type: 'object', additionalProperties: true, description: '结构化剧本' },
      assets: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '角色与场景资产定义' },
      updates: { type: 'object', additionalProperties: true, description: '单集更新字段' },
      taskId: { type: 'string', description: '精确重试的任务 ID' },
      issueId: { type: 'string', description: '待处理问题 ID' },
      path: { type: 'string', description: '要采用的历史产物路径' },
      resolution: { type: 'string', description: '问题处理方式，当前支持 retry' },
      confirmAuthorizedContent: { type: 'boolean', description: '本次单集付费生成授权' },
      confirmHumanReviewPassed: { type: 'boolean', description: '新流程人工终审确认' },
      template: { type: 'string', description: '内置 ComfyUI 工作流模板 ID' },
      query: { type: 'string', description: '内置 ComfyUI 模型或 LoRA 查询词' },
      id: { type: 'string', description: '内置 ComfyUI 模板 ID' },
      name: { type: 'string', description: '内置 ComfyUI LoRA 文件名' },
      overwrite: { type: 'boolean', description: '导入 ComfyUI 模板时是否覆盖同名模板' },
      jobAction: { type: 'string', description: 'ComfyUI 任务动作：status | wait | cancel' },
      wait_s: { type: 'number', description: '等待 ComfyUI 任务的最长秒数' },
      trigger_words: { type: 'string', description: 'LoRA 正向提示触发词' },
      mode: { type: 'string', description: 'LoRA 模式：both | model-only' },
      note: { type: 'string', description: '工作流或 LoRA 使用说明' },
      comfyArgs: { type: 'object', additionalProperties: true, description: 'comfyui_generate 的完整合同参数；先执行 comfyui_inspect' },
      comfySettings: { type: 'object', additionalProperties: true, description: 'comfyui_save 的设置补丁' },
      index: { type: 'number', description: '创作步骤序号，1 到 15' },
      value: { type: 'object', additionalProperties: true, description: '创作步骤结果；数组结果放在 items 字段里' },
      items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '创作步骤的数组结果（角色、场景、章节、分镜、环境音）' },
      expectedRevision: { type: 'number', description: '保存创作步骤时的乐观锁修订号' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      try {
        const input = args || {}
        const handlers = {
          project_list: () => projectList(config),
          project_create: () => projectCreate(config, input),
          project_get: () => projectGet(config, input),
          episode_create: () => createPlannedEpisode(config, planner, input),
          episode_list: () => episodeList(config, input),
          episode_get: () => episodeGet(config, input),
          episode_update: () => updatePlannedEpisode(config, planner, input),
          production_start: () => production.start(input),
          production_pause: () => production.pause(input),
          production_resume: () => production.resume(input),
          production_status: () => production.status(input),
          production_retry: () => production.retry(input),
          artifact_adopt: () => production.adopt(input),
          issue_resolve: () => production.resolveIssue(input),
          review_approve: () => production.approve(input),
          // 创作阶段：只读与草稿写。批准、同步和退回定稿不在这里，必须由用户在界面上做。
          creation_list_directors: () => ({ ok: true, catalogVersion: DIRECTORS_VERSION, directors: listDirectors() }),
          creation_get_state: () => creation.getState(input),
          creation_save_step: () => creation.saveStep({
            projectId: input.projectId,
            index: input.index,
            value: Array.isArray(input.items) ? input.items : input.value,
            expectedRevision: input.expectedRevision,
          }),
          creation_confirm_step: () => creation.confirmStep(input),
          creation_compile_story: () => creation.compileStory(input),
          // 一句话入口：只开放提交与查询。授权与终审是界面动作，不在这里。
          oneline_submit: () => oneline.submit(input),
          oneline_status: () => oneline.status(input),
          oneline_redo: () => oneline.redo(input),
          comfyui_state: () => comfy.state(),
          comfyui_inspect: () => comfy.inspect(input.template, input.query),
          comfyui_generate: () => comfy.generate({ ...(input.comfyArgs || {}), template: input.template || input.comfyArgs?.template }),
          comfyui_job: () => comfy.job({ job_id: input.job_id, action: input.jobAction || 'status', wait_s: input.wait_s }),
          comfyui_scan: () => comfy.scan(input),
          comfyui_import: () => comfy.importTemplate(input),
          comfyui_remove_template: () => comfy.removeTemplate(input.id),
          comfyui_save: () => comfy.saveSettings(input.comfySettings || {}),
          comfyui_register_lora: () => comfy.registerLora(input),
          comfyui_remove_lora: () => comfy.removeLora(input.name),
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
