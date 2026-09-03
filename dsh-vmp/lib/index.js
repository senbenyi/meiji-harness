import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = '@dsh-external/dsh-vmp'
export const inject = ['tools']
export const Config = z.object({
  adapter: z.string().default(''),
  specRoot: z.string().default(''),
  localArtifactsRoot: z.string().default(''),
})

const SPEC_NAME = /^[a-z0-9][a-z0-9.-]{0,126}\.json$/
const EPISODE_ID = /^mvp-[a-z0-9]+(?:-[a-z0-9]+)*$/
const GPU_STAGES = new Set(['images', 'video', 'all'])
const RUN_STAGES = new Set(['images', 'video', 'final', 'all', 'approve'])
const LOG_LIMIT = 64 * 1024
const API = '/vmp/api'

class VmpPluginError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function settings(config = {}) {
  if (!config.adapter || !config.specRoot || !config.localArtifactsRoot) {
    throw new VmpPluginError('VMP_NOT_CONFIGURED', 'adapter, specRoot and localArtifactsRoot are required', 503)
  }
  return {
    adapter: path.resolve(config.adapter),
    specRoot: path.resolve(config.specRoot),
    localArtifactsRoot: path.resolve(config.localArtifactsRoot),
  }
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function parseMarker(output) {
  for (const line of output.split(/\r?\n/).reverse()) {
    if (!line.startsWith('[VMP_RESULT] ')) continue
    try { return JSON.parse(line.slice('[VMP_RESULT] '.length)) } catch { break }
  }
  throw new VmpPluginError('VMP_INVALID_RESPONSE', 'VMP did not return a valid result marker', 502)
}

function parseArtifact(output) {
  for (const line of output.split(/\r?\n/).reverse()) {
    if (line.startsWith('[VMP_ARTIFACT] ')) return line.slice('[VMP_ARTIFACT] '.length).trim()
  }
  throw new VmpPluginError('VMP_INVALID_RESPONSE', 'VMP did not return an artifact path', 502)
}

async function resolveSpec(cfg, name) {
  if (typeof name !== 'string' || !SPEC_NAME.test(name) || name.includes('..')) {
    throw new VmpPluginError('INVALID_SPEC', 'spec must be a safe JSON filename')
  }
  const root = await realpath(cfg.specRoot)
  const candidate = await realpath(path.resolve(cfg.specRoot, name)).catch(error => {
    if (error?.code === 'ENOENT') throw new VmpPluginError('SPEC_NOT_FOUND', `Spec not found: ${name}`, 404)
    throw error
  })
  if (!isContained(root, candidate)) throw new VmpPluginError('INVALID_SPEC', 'spec escapes configured root')
  let value
  try { value = JSON.parse(await readFile(candidate, 'utf8')) } catch (error) {
    throw new VmpPluginError('INVALID_SPEC', `Invalid spec: ${error?.message || error}`)
  }
  if (!EPISODE_ID.test(value?.episode_id || '')) throw new VmpPluginError('INVALID_SPEC', 'episode_id is invalid')
  return { name, path: candidate, value }
}

function runProcess(executable, args, options, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const append = chunk => {
      output += chunk.toString('utf8')
      if (output.length > LOG_LIMIT) output = output.slice(-LOG_LIMIT)
      onChunk?.(chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
}

export function createVmpService(config = {}) {
  const cfg = settings(config)
  const jobs = new Map()
  const adapterEnv = { ...process.env, VMP_LOCAL_ARTIFACTS_ROOT: cfg.localArtifactsRoot }

  async function preflight() {
    try {
      await access(cfg.adapter)
      await stat(cfg.specRoot)
    } catch {
      throw new VmpPluginError('VMP_UNAVAILABLE', `VMP paths are unavailable: ${cfg.adapter}`, 503)
    }
  }

  async function list() {
    await preflight()
    const entries = await readdir(cfg.specRoot, { withFileTypes: true })
    const specs = []
    for (const entry of entries.filter(item => item.isFile() && SPEC_NAME.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const spec = await resolveSpec(cfg, entry.name)
        specs.push({ name: entry.name, episodeId: spec.value.episode_id, title: spec.value.title || spec.value.episode_id,
          profile: spec.value.profile || 'unknown' })
      } catch { specs.push({ name: entry.name, invalid: true }) }
    }
    return { ok: true, specs }
  }

  async function execute(specName, stage) {
    await preflight()
    const spec = await resolveSpec(cfg, specName)
    const result = await runProcess('bash', [cfg.adapter, '--spec', spec.path, '--stage', stage, '--json'], {
      cwd: path.dirname(cfg.adapter), env: adapterEnv,
    })
    const value = parseMarker(result.output)
    if (result.code !== 0 || value?.ok === false) {
      throw new VmpPluginError('VMP_FAILED', value?.error || `VMP exited with ${result.code}`, 409)
    }
    return value
  }

  async function syncArtifact(episodeId, artifact) {
    const result = await runProcess('bash', [cfg.adapter, '--episode-id', episodeId, '--artifact', artifact], {
      cwd: path.dirname(cfg.adapter), env: adapterEnv,
    })
    if (result.code !== 0) throw new VmpPluginError('VMP_SYNC_FAILED', result.output.trim() || `sync exited with ${result.code}`, 502)
    const localPath = path.resolve(parseArtifact(result.output))
    if (!isContained(cfg.localArtifactsRoot, localPath)) throw new VmpPluginError('VMP_INVALID_RESPONSE', 'artifact escaped local root', 502)
    return localPath
  }

  function publicJob(job) {
    if (!job) return null
    const { child: _child, ...safe } = job
    return { ...safe, log: safe.log.split(/\r?\n/).slice(-80).join('\n') }
  }

  async function submit(body = {}) {
    const stage = String(body.stage || '')
    if (!RUN_STAGES.has(stage)) throw new VmpPluginError('INVALID_STAGE', 'stage must be images, video, final, all or approve')
    if (GPU_STAGES.has(stage) && body.confirmed !== true) {
      throw new VmpPluginError('CONFIRMATION_REQUIRED', 'GPU work requires explicit adult, rights and cost confirmation')
    }
    if (stage === 'approve' && (body.reviewConfirmed !== true || !/^[A-Za-z0-9._-]{1,80}$/.test(body.reviewer || ''))) {
      throw new VmpPluginError('CONFIRMATION_REQUIRED', 'approve requires a safe reviewer and explicit human review confirmation')
    }
    await preflight()
    const spec = await resolveSpec(cfg, body.spec)
    const previous = jobs.get(spec.value.episode_id)
    if (previous?.status === 'running' || previous?.status === 'syncing') {
      throw new VmpPluginError('VMP_BUSY', `Episode is already running: ${spec.value.episode_id}`, 409)
    }
    const args = [cfg.adapter, '--spec', spec.path, '--stage', stage, '--json']
    if (GPU_STAGES.has(stage)) args.push('--confirm-authorized-adults')
    if (stage === 'approve') args.push('--reviewer', body.reviewer, '--confirm-human-review-passed')
    const job = {
      id: `${spec.value.episode_id}:${Date.now()}`, episodeId: spec.value.episode_id,
      spec: spec.name, stage, status: 'running', exitCode: null, log: '', result: null,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: null,
    }
    jobs.set(job.episodeId, job)
    const child = spawn('bash', args, { cwd: path.dirname(cfg.adapter), env: adapterEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    job.child = child
    const append = chunk => {
      job.log += chunk.toString('utf8')
      if (job.log.length > LOG_LIMIT) job.log = job.log.slice(-LOG_LIMIT)
      job.updatedAt = new Date().toISOString()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', error => {
      job.status = 'failed'; job.error = error.message; job.updatedAt = new Date().toISOString()
    })
    child.on('close', async code => {
      job.exitCode = code
      try {
        job.result = parseMarker(job.log)
        if (code !== 0 || job.result?.ok === false) throw new Error(job.result?.error || `VMP exited with ${code}`)
        if (job.result.technical_complete) {
          job.status = 'syncing'
          append('\n[VMP] 正在同步成片与 QC…\n')
          await syncArtifact(job.episodeId, 'final')
          await syncArtifact(job.episodeId, 'qc')
        }
        if (job.result.delivery_complete) await syncArtifact(job.episodeId, 'review')
        job.status = 'complete'
      } catch (error) {
        job.status = 'failed'; job.error = error.message
      }
      delete job.child
      job.updatedAt = new Date().toISOString()
    })
    return { ok: true, job: publicJob(job) }
  }

  async function job(body = {}) {
    const spec = await resolveSpec(cfg, body.spec)
    return { ok: true, job: publicJob(jobs.get(spec.value.episode_id)) }
  }

  async function sync(body = {}) {
    const spec = await resolveSpec(cfg, body.spec)
    const artifacts = {}
    for (const name of ['final', 'qc']) artifacts[name] = await syncArtifact(spec.value.episode_id, name)
    return { ok: true, episodeId: spec.value.episode_id, artifacts }
  }

  async function artifact(body = {}) {
    const spec = await resolveSpec(cfg, body.spec)
    const relative = { final: 'final/final.mp4', qc: 'final/qc-report.json', review: 'final/human-review.json' }[body.artifact]
    if (!relative) throw new VmpPluginError('INVALID_ARTIFACT', 'artifact must be final, qc or review')
    const root = path.resolve(cfg.localArtifactsRoot, spec.value.episode_id)
    const candidate = path.resolve(root, relative)
    if (!isContained(root, candidate)) throw new VmpPluginError('INVALID_ARTIFACT', 'artifact path is invalid')
    const info = await stat(candidate).catch(() => null)
    if (!info?.isFile() || info.size === 0) throw new VmpPluginError('ARTIFACT_NOT_FOUND', 'artifact is not synced', 404)
    return { path: candidate, size: info.size }
  }

  return { list, check: body => execute(body.spec, 'check'), status: body => execute(body.spec, 'status'), submit, job, sync, artifact }
}

function trusted(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined) return true
  const host = req.headers?.host
  if (!host || origin === 'null') return false
  try { return new URL(origin).hostname === new URL(`http://${host}`).hostname } catch { return false }
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new VmpPluginError('BODY_TOO_LARGE', 'request body is too large', 413)
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch {
    throw new VmpPluginError('INVALID_JSON', 'request body must be JSON')
  }
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function attachApi(ctx, service) {
  return ctx.effect(() => {
    const disposeApi = ctx.webServer.register({
      kind: 'prefix', path: API,
      handler: async (req, res) => {
        if (!trusted(req)) return send(res, 403, { ok: false, code: 'FORBIDDEN', error: 'untrusted request' })
        if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'POST required' })
        try {
          const sub = new URL(req.url || '/', 'http://dsh.internal').pathname.replace(/^\/vmp\/api/, '') || '/'
          const routes = { '/list': 'list', '/check': 'check', '/status': 'status', '/run': 'submit', '/job': 'job', '/sync': 'sync' }
          const method = routes[sub]
          if (!method) throw new VmpPluginError('NOT_FOUND', `unknown route: ${sub}`, 404)
          return send(res, 200, await service[method](await body(req)))
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 500
          return send(res, status, { ok: false, code: error.code || 'INTERNAL_ERROR',
            error: status >= 500 ? 'Internal server error' : error.message })
        }
      },
    })
    const disposeFile = ctx.webServer.register({
      kind: 'prefix', path: '/vmp/file',
      handler: async (req, res) => {
        if (!trusted(req)) { res.writeHead(403); return res.end() }
        if (req.method !== 'GET') { res.writeHead(405); return res.end() }
        try {
          const url = new URL(req.url || '/', 'http://dsh.internal')
          const item = await service.artifact({ spec: url.searchParams.get('spec'), artifact: url.searchParams.get('artifact') })
          const isVideo = path.extname(item.path).toLowerCase() === '.mp4'
          const type = isVideo ? 'video/mp4' : 'application/json; charset=utf-8'
          const match = isVideo && req.headers?.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null
          if (isVideo && req.headers?.range && !match) { res.writeHead(416, { 'content-range': `bytes */${item.size}` }); return res.end() }
          if (match) {
            const start = match[1] ? Number(match[1]) : 0
            const end = match[2] ? Math.min(Number(match[2]), item.size - 1) : item.size - 1
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= item.size) {
              res.writeHead(416, { 'content-range': `bytes */${item.size}` }); return res.end()
            }
            res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${item.size}`,
              'content-length': end - start + 1, 'cache-control': 'no-cache' })
            return createReadStream(item.path, { start, end }).pipe(res)
          }
          res.writeHead(200, { 'content-type': type, 'content-length': item.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' })
          return createReadStream(item.path).pipe(res)
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 500
          res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
          return res.end(status >= 500 ? 'Internal server error' : error.message)
        }
      },
    })
    return () => { disposeFile?.(); disposeApi?.() }
  }, '@dsh-external/dsh-vmp: api')
}

const textOut = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
const dump = value => JSON.stringify(value, null, 2)

export function apply(ctx, config) {
  const service = createVmpService(config)
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], scope => attachApi(scope, service))
  else if (ctx.get?.('webServer')) attachApi(ctx, service)
  ctx.effect(() => ctx.tools.register(defineTool({
    name: '_dsh_external_dsh_vmp',
    description: 'VMP AI 短视频唯一操作工具。list/check/status/run/job/sync；不直接调用 ComfyUI。GPU run 必须得到用户本次明确授权。',
    parameters: {
      action: { type: 'string', required: true, description: 'list | check | status | run | job | sync' },
      spec: { type: 'string', description: 'workflows/mvp/episodes 下的 JSON 文件名' },
      stage: { type: 'string', description: 'run: images | video | final | all | approve' },
      confirmed: { type: 'boolean', description: 'GPU 阶段的成年人、权利和本次成本确认' },
      reviewer: { type: 'string', description: 'approve 的验收人，只允许字母数字点下划线连字符' },
      review_confirmed: { type: 'boolean', description: '已完整观看并通过五项人工验收' },
    },
    output: textOut,
    async execute(args) {
      try {
        if (args.action === 'list') return dump(await service.list())
        if (args.action === 'check') return dump(await service.check({ spec: args.spec }))
        if (args.action === 'status') return dump(await service.status({ spec: args.spec }))
        if (args.action === 'job') return dump(await service.job({ spec: args.spec }))
        if (args.action === 'sync') return dump(await service.sync({ spec: args.spec }))
        if (args.action === 'run') return dump(await service.submit({ spec: args.spec, stage: args.stage,
          confirmed: args.confirmed, reviewer: args.reviewer, reviewConfirmed: args.review_confirmed }))
        return dump({ ok: false, code: 'INVALID_ACTION', message: 'action must be list, check, status, run, job or sync' })
      } catch (error) { return dump({ ok: false, code: error.code || 'ERROR', message: error.message }) }
    },
  })), '@dsh-external/dsh-vmp: tool')
}
