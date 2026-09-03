import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

const SHOT_IDS = Array.from({ length: 12 }, (_, index) => `shot-${String(index + 1).padStart(2, '0')}`)
const MUTATING_STAGES = new Set(['images', 'video', 'final', 'all'])
const GPU_STAGES = new Set(['images', 'video', 'all'])
const ARTIFACTS = {
  final: { relative: 'final/final.mp4', type: 'video/mp4' },
  qc: { relative: 'final/qc-report.json', type: 'application/json; charset=utf-8' },
  review: { relative: 'final/human-review.json', type: 'application/json; charset=utf-8' },
}
const MAX_LOG_BYTES = 128 * 1024
const MAX_SPEC_BYTES = 1024 * 1024

function pipelineError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

function appendBounded(current, chunk) {
  const combined = current + String(chunk)
  return combined.length <= MAX_LOG_BYTES ? combined : combined.slice(-MAX_LOG_BYTES)
}

function safeEpisodeId(value) {
  const id = String(value || '').trim()
  if (!/^mvp-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw pipelineError('INVALID_EPISODE_ID', 'episode_id 必须使用 mvp- 开头的小写字母、数字和连字符')
  }
  return id
}

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw pipelineError('INVALID_SPEC', `${field} 不能为空`)
  return text
}

export function validateEpisodeSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw pipelineError('INVALID_SPEC', '生产单必须是 JSON object')
  }
  const episodeId = safeEpisodeId(value.episode_id)
  if (value.schema_version !== 'vmp-1') throw pipelineError('INVALID_SPEC', 'schema_version 必须是 vmp-1')
  if (!['preview', 'final'].includes(value.profile)) throw pipelineError('INVALID_SPEC', 'profile 必须是 preview 或 final')
  requireText(value.title, 'title')
  requireText(value.source_text, 'source_text')
  requireText(value.cast_prompt, 'cast_prompt')
  requireText(value.negative_prompt, 'negative_prompt')
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) {
    throw pipelineError('INVALID_SPEC', 'seed 必须是 0..4294967295 的整数')
  }
  const compliance = value.compliance
  for (const key of ['fictional_adults_only', 'all_participants_18_or_older', 'consensual_content', 'rights_confirmed']) {
    if (compliance?.[key] !== true) throw pipelineError('COMPLIANCE_REQUIRED', `compliance.${key} 必须明确为 true`)
  }
  if (!Array.isArray(value.shots) || value.shots.length !== 12) {
    throw pipelineError('INVALID_SPEC', 'VMP V1 固定需要 12 镜')
  }
  value.shots.forEach((shot, index) => {
    if (!shot || typeof shot !== 'object' || shot.id !== SHOT_IDS[index]) {
      throw pipelineError('INVALID_SPEC', `第 ${index + 1} 镜 id 必须是 ${SHOT_IDS[index]}`)
    }
    requireText(shot.image_prompt, `${shot.id}.image_prompt`)
    requireText(shot.video_prompt, `${shot.id}.video_prompt`)
  })
  return {
    episode_id: episodeId,
    title: value.title.trim(),
    profile: value.profile,
    seed: value.seed,
    shots: 12,
    blocks: 2,
    minimum_duration_seconds: 40,
  }
}

function resolvedPipelineConfig(config = {}) {
  return {
    adapter: String(config.pipelineAdapter || '').trim(),
    specRoot: path.resolve(String(config.pipelineSpecRoot || '')),
    artifactsRoot: path.resolve(String(config.pipelineArtifactsRoot || '')),
  }
}

function ensureConfigured(config) {
  const resolved = resolvedPipelineConfig(config)
  if (!resolved.adapter || !path.isAbsolute(resolved.adapter)) {
    throw pipelineError('PIPELINE_NOT_CONFIGURED', 'pipelineAdapter 必须配置为绝对路径', 503)
  }
  if (!config.pipelineSpecRoot || !path.isAbsolute(String(config.pipelineSpecRoot))) {
    throw pipelineError('PIPELINE_NOT_CONFIGURED', 'pipelineSpecRoot 必须配置为绝对路径', 503)
  }
  if (!config.pipelineArtifactsRoot || !path.isAbsolute(String(config.pipelineArtifactsRoot))) {
    throw pipelineError('PIPELINE_NOT_CONFIGURED', 'pipelineArtifactsRoot 必须配置为绝对路径', 503)
  }
  return resolved
}

async function ensureAdapter(config) {
  const resolved = ensureConfigured(config)
  const info = await stat(resolved.adapter).catch(() => null)
  if (!info?.isFile()) throw pipelineError('PIPELINE_ADAPTER_MISSING', 'VMP 远程适配器不存在', 503)
  return resolved
}

function safeSpecName(value) {
  const name = path.basename(String(value || '').trim())
  if (!/^[a-z0-9][a-z0-9.-]{0,126}\.json$/.test(name)) {
    throw pipelineError('INVALID_SPEC_NAME', '生产单文件名只允许小写字母、数字、点和连字符，并以 .json 结尾')
  }
  return name
}

async function resolveSpec(config, value) {
  const resolved = ensureConfigured(config)
  const raw = String(value || '').trim()
  if (!raw) throw pipelineError('SPEC_REQUIRED', 'spec 不能为空')
  const filename = safeSpecName(raw)
  const candidate = path.resolve(resolved.specRoot, filename)
  if (path.dirname(candidate) !== resolved.specRoot) throw pipelineError('INVALID_SPEC_PATH', '生产单必须位于配置目录根层')
  const actual = await realpath(candidate).catch(() => null)
  if (!actual || path.dirname(actual) !== await realpath(resolved.specRoot).catch(() => resolved.specRoot)) {
    throw pipelineError('SPEC_NOT_FOUND', `生产单不存在：${filename}`, 404)
  }
  const info = await stat(actual)
  if (!info.isFile() || info.size <= 0 || info.size > MAX_SPEC_BYTES) {
    throw pipelineError('INVALID_SPEC', '生产单必须是 1 MB 以内的非空文件')
  }
  const episode = JSON.parse(await readFile(actual, 'utf8'))
  return { path: actual, filename, episode, summary: validateEpisodeSpec(episode) }
}

async function createSpec(config, episode) {
  const resolved = ensureConfigured(config)
  const summary = validateEpisodeSpec(episode)
  await mkdir(resolved.specRoot, { recursive: true })
  const filename = safeSpecName(`${summary.episode_id}.json`)
  const destination = path.join(resolved.specRoot, filename)
  const handle = await open(destination, 'wx').catch(error => {
    if (error?.code === 'EEXIST') throw pipelineError('SPEC_EXISTS', `生产单已存在：${filename}`, 409)
    throw error
  })
  try {
    await handle.writeFile(`${JSON.stringify(episode, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { ok: true, created: true, spec: filename, summary }
}

async function listSpecs(config) {
  const resolved = ensureConfigured(config)
  await mkdir(resolved.specRoot, { recursive: true })
  const specs = []
  for (const entry of await readdir(resolved.specRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-z0-9][a-z0-9.-]{0,126}\.json$/.test(entry.name)) continue
    try {
      const loaded = await resolveSpec(config, entry.name)
      specs.push({ spec: entry.name, valid: true, ...loaded.summary })
    } catch (error) {
      specs.push({ spec: entry.name, valid: false, code: error.code || 'INVALID_SPEC', error: error.message })
    }
  }
  specs.sort((a, b) => a.spec.localeCompare(b.spec))
  return { ok: true, contract: { shots: 12, blocks: 2, minimum_duration_seconds: 40 }, specs }
}

function parseMarker(output, marker) {
  const lines = String(output || '').split(/\r?\n/).reverse()
  const line = lines.find(item => item.startsWith(marker))
  if (!line) return null
  const payload = line.slice(marker.length).trim()
  if (marker === '[VMP_ARTIFACT]') return payload
  try { return JSON.parse(payload) } catch { return null }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    action: job.action,
    stage: job.stage,
    spec: job.spec,
    episode_id: job.episode_id,
    created_at: job.created_at,
    finished_at: job.finished_at || null,
    exit_code: job.exit_code ?? null,
    result: job.result || null,
    error: job.error || null,
    log_tail: (job.stdout + job.stderr).slice(-8000),
  }
}

function adapterArgs(request) {
  if (request.action === 'sync') {
    return ['--episode-id', request.episode_id, '--artifact', request.artifact]
  }
  const args = ['--spec', request.specPath, '--stage', request.stage, '--json']
  if (request.confirm_authorized_adults) args.push('--confirm-authorized-adults')
  if (request.confirm_human_review_passed) args.push('--confirm-human-review-passed')
  if (request.reviewer) args.push('--reviewer', request.reviewer)
  return args
}

function launch(config, request, { asynchronous }) {
  const id = `vmp-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const job = {
    id,
    status: 'running',
    action: request.action,
    stage: request.stage || null,
    spec: request.spec || null,
    episode_id: request.episode_id || null,
    created_at: new Date().toISOString(),
    stdout: '',
    stderr: '',
  }
  const child = spawn('/bin/bash', [config.adapter, ...adapterArgs(request)], {
    cwd: path.dirname(config.adapter),
    env: {
      ...process.env,
      VMP_LOCAL_SPEC_ROOT: config.specRoot,
      VMP_LOCAL_ARTIFACTS_ROOT: config.artifactsRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  job.pid = child.pid
  jobs.set(id, job)
  child.stdout.on('data', chunk => { job.stdout = appendBounded(job.stdout, chunk) })
  child.stderr.on('data', chunk => { job.stderr = appendBounded(job.stderr, chunk) })
  const completion = new Promise((resolve) => {
    child.once('error', error => {
      job.status = 'failed'
      job.error = error.message
      job.finished_at = new Date().toISOString()
      resolve(publicJob(job))
    })
    child.once('close', code => {
      job.exit_code = code
      job.finished_at = new Date().toISOString()
      if (code === 0) {
        job.status = 'succeeded'
        job.result = request.action === 'sync'
          ? { ok: true, artifact: request.artifact, path: parseMarker(job.stdout, '[VMP_ARTIFACT]') }
          : parseMarker(job.stdout, '[VMP_RESULT]') || { ok: true }
      } else {
        job.status = 'failed'
        job.error = (job.stderr || job.stdout || `adapter exited ${code}`).trim().slice(-4000)
      }
      resolve(publicJob(job))
    })
  })
  job.completion = completion
  return asynchronous ? Promise.resolve(publicJob(job)) : completion
}

export const jobs = new Map()

export function createPipelineService(getConfig) {
  async function execute(args = {}) {
    const action = String(args.action || 'list')
    const config = await ensureAdapter(getConfig())
    if (action === 'list') return listSpecs(getConfig())
    if (action === 'create') return createSpec(getConfig(), args.episode)
    if (action === 'job') {
      const job = jobs.get(String(args.job_id || ''))
      if (!job) throw pipelineError('JOB_NOT_FOUND', '本机流水线任务不存在；请使用同一生产单执行 status 恢复远端状态', 404)
      return { ok: true, job: publicJob(job) }
    }
    if (action === 'sync') {
      const episodeId = safeEpisodeId(args.episode_id)
      if (!ARTIFACTS[args.artifact]) throw pipelineError('INVALID_ARTIFACT', 'artifact 必须是 final、qc 或 review')
      const job = await launch(config, { action, episode_id: episodeId, artifact: args.artifact }, { asynchronous: false })
      if (job.status !== 'succeeded') throw pipelineError('PIPELINE_FAILED', job.error || '产物同步失败', 502)
      return { ok: true, ...job.result }
    }

    const loaded = await resolveSpec(getConfig(), args.spec)
    if (action === 'check' || action === 'status') {
      const job = await launch(config, {
        action,
        stage: action,
        spec: loaded.filename,
        specPath: loaded.path,
        episode_id: loaded.summary.episode_id,
      }, { asynchronous: false })
      if (job.status !== 'succeeded') throw pipelineError('PIPELINE_FAILED', job.error || `${action} 失败`, 502)
      return { ok: true, spec: loaded.filename, contract: loaded.summary, remote: job.result }
    }
    if (action === 'approve') {
      if (args.confirm_human_review_passed !== true) throw pipelineError('HUMAN_REVIEW_REQUIRED', '必须完整观看成片并明确确认人工验收通过')
      const reviewer = String(args.reviewer || '').trim()
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(reviewer)) throw pipelineError('INVALID_REVIEWER', 'reviewer 只允许字母、数字、点、下划线和连字符')
      const job = await launch(config, {
        action,
        stage: 'approve',
        spec: loaded.filename,
        specPath: loaded.path,
        episode_id: loaded.summary.episode_id,
        reviewer,
        confirm_human_review_passed: true,
      }, { asynchronous: false })
      if (job.status !== 'succeeded') throw pipelineError('PIPELINE_FAILED', job.error || '人工验收登记失败', 502)
      return { ok: true, spec: loaded.filename, contract: loaded.summary, remote: job.result }
    }
    if (action !== 'run') throw pipelineError('INVALID_ACTION', 'action 必须是 list、create、check、status、run、job、sync 或 approve')
    const stage = String(args.stage || 'all')
    if (!MUTATING_STAGES.has(stage)) throw pipelineError('INVALID_STAGE', 'stage 必须是 images、video、final 或 all')
    if (GPU_STAGES.has(stage) && args.confirm_authorized_adults !== true) {
      throw pipelineError('ADULTS_CONFIRMATION_REQUIRED', '付费生成前必须确认角色均为已授权的虚构成年人、内容自愿且素材权利清晰')
    }
    const active = [...jobs.values()].find(job => job.status === 'running' && job.action === 'run')
    if (active) throw pipelineError('PIPELINE_BUSY', `已有生产任务运行中：${active.id}`, 409)
    const job = await launch(config, {
      action,
      stage,
      spec: loaded.filename,
      specPath: loaded.path,
      episode_id: loaded.summary.episode_id,
      confirm_authorized_adults: args.confirm_authorized_adults === true,
    }, { asynchronous: true })
    return { ok: true, accepted: true, contract: loaded.summary, job }
  }

  return { execute }
}

function artifactPath(config, episodeId, artifact) {
  const resolved = ensureConfigured(config)
  const item = ARTIFACTS[artifact]
  if (!item) throw pipelineError('INVALID_ARTIFACT', 'artifact 必须是 final、qc 或 review')
  return { item, file: path.join(resolved.artifactsRoot, safeEpisodeId(episodeId), item.relative) }
}

export async function servePipelineArtifact(req, res, config) {
  try {
    const url = new URL(req.url || '/', 'http://dsh.internal')
    const { item, file } = artifactPath(config, url.searchParams.get('episode_id'), url.searchParams.get('artifact'))
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0) throw pipelineError('ARTIFACT_NOT_FOUND', '本地产物尚未同步', 404)
    const range = req.headers?.range
    if (range && item.type === 'video/mp4') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) throw pipelineError('INVALID_RANGE', 'Invalid Range header', 416)
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Number(match[2]) : info.size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= info.size) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` })
        return res.end()
      }
      res.writeHead(206, {
        'content-type': item.type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': end - start + 1,
        'cache-control': 'no-store',
      })
      return createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, {
      'content-type': item.type,
      'content-length': info.size,
      'accept-ranges': item.type === 'video/mp4' ? 'bytes' : 'none',
      'cache-control': 'no-store',
    })
    createReadStream(file).pipe(res)
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : (error?.code === 'ENOENT' ? 404 : 500)
    res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, code: error?.code || 'ARTIFACT_ERROR', error: statusCode >= 500 ? 'Internal server error' : error.message }))
  }
}
