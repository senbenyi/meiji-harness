import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { ElysiumError, readJson, workspaceRoot, writeJsonAtomic } from '../infrastructure/store.js'
import { createComfyUiService } from '../infrastructure/comfyui/service.js'

export const FACTORY_TOOL = '_dsh_external_dsh_elysium_factory'
const SHOT_COUNT = 2
const BLOCK_COUNT = 2
const ANCHORS_PER_BLOCK = 6
const MINIMUM_DURATION_SECONDS = 40
const SHOT_IDS = Array.from({ length: SHOT_COUNT }, (_, index) => `shot-${String(index + 1).padStart(2, '0')}`)
const BLOCK_IDS = ['block-01', 'block-02']
const running = new Map()

function fail(code, message, status = 400) {
  throw new ElysiumError(code, message, status)
}

function safeEpisodeId(value) {
  const id = String(value || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail('INVALID_EPISODE_ID', 'episode_id 无效')
  }
  return id
}

function requiredText(value, field, max = 10000) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) fail('INVALID_SPEC', `${field} 不能为空`)
  if (result.length > max) fail('INVALID_SPEC', `${field} 不能超过 ${max} 个字符`)
  return result
}

export function validateEpisodeSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SPEC', '生产单必须是 JSON object')
  const episodeId = safeEpisodeId(value.episode_id)
  if (value.schema_version !== 'vmp-1') fail('INVALID_SPEC', 'schema_version 必须是 vmp-1')
  if (!['preview', 'final'].includes(value.profile)) fail('INVALID_SPEC', 'profile 必须是 preview 或 final')
  requiredText(value.title, 'title', 120)
  requiredText(value.source_text, 'source_text')
  requiredText(value.cast_prompt, 'cast_prompt')
  requiredText(value.negative_prompt, 'negative_prompt')
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) fail('INVALID_SPEC', 'seed 必须是 0..4294967295 的整数')
  for (const key of ['fictional_adults_only', 'all_participants_18_or_older', 'consensual_content', 'rights_confirmed']) {
    if (value.compliance?.[key] !== true) fail('COMPLIANCE_REQUIRED', `compliance.${key} 必须明确为 true`)
  }
  if (!Array.isArray(value.shots) || value.shots.length !== SHOT_COUNT) fail('INVALID_SPEC', `固定需要 ${SHOT_COUNT} 镜`)
  value.shots.forEach((shot, index) => {
    if (!shot || typeof shot !== 'object' || shot.id !== SHOT_IDS[index]) fail('INVALID_SPEC', `第 ${index + 1} 镜 id 必须是 ${SHOT_IDS[index]}`)
    requiredText(shot.image_prompt, `${shot.id}.image_prompt`)
    requiredText(shot.video_prompt, `${shot.id}.video_prompt`)
  })
  return { episode_id: episodeId, title: value.title.trim(), profile: value.profile, seed: value.seed, shots: SHOT_COUNT, blocks: BLOCK_COUNT, minimum_duration_seconds: MINIMUM_DURATION_SECONDS }
}

function factoryRoot(config) {
  return path.join(workspaceRoot(config), 'factory')
}

function episodePaths(config, episodeId) {
  const dir = path.join(factoryRoot(config), safeEpisodeId(episodeId))
  return {
    dir,
    spec: path.join(dir, 'spec.json'),
    state: path.join(dir, 'state.json'),
    images: path.join(dir, 'images'),
    blocks: path.join(dir, 'blocks'),
    final: path.join(dir, 'final'),
  }
}

const now = () => new Date().toISOString()

function initialState(spec) {
  const stamp = now()
  return {
    schema_version: 'elysium-factory-1',
    episode_id: spec.episode_id,
    status: 'ready',
    stage: 'ready',
    contract: { shots: SHOT_COUNT, blocks: BLOCK_COUNT, minimum_duration_seconds: MINIMUM_DURATION_SECONDS },
    created_at: stamp,
    updated_at: stamp,
    images: SHOT_IDS.map(id => ({ id, status: 'pending', job_id: null, path: null, error: null })),
    blocks: BLOCK_IDS.map((id, index) => ({ id, shots: [SHOT_IDS[index]], status: 'pending', job_id: null, path: null, error: null })),
    final: { status: 'pending', path: null, qc_path: null, duration_seconds: null, error: null },
    review: null,
    events: [{ at: stamp, type: 'created', message: '2 镜、2 视频生产单已创建' }],
  }
}

function publicState(state) {
  return {
    ...state,
    progress: {
      images_ready: state.images.filter(item => item.status === 'ready').length,
      blocks_ready: state.blocks.filter(item => item.status === 'ready').length,
      final_ready: state.final.status === 'qc_passed' || state.status === 'approved',
    },
  }
}

function addEvent(state, type, message) {
  state.events = [...(state.events || []), { at: now(), type, message }].slice(-200)
  state.updated_at = now()
}

async function loadEpisode(config, episodeId) {
  const p = episodePaths(config, episodeId)
  const [spec, state] = await Promise.all([
    readJson(p.spec).catch(error => {
      if (error?.code === 'ENOENT') fail('EPISODE_NOT_FOUND', `生产单不存在：${episodeId}`, 404)
      throw error
    }),
    readJson(p.state).catch(error => {
      if (error?.code === 'ENOENT') fail('EPISODE_NOT_FOUND', `生产状态不存在：${episodeId}`, 404)
      throw error
    }),
  ])
  validateEpisodeSpec(spec)
  return { p, spec, state }
}

async function saveState(p, state) {
  state.updated_at = now()
  await writeJsonAtomic(p.state, state)
}

async function callComfy(comfy, method, args) {
  const result = await comfy[method](args)
  if (!result?.ok) fail(result?.code || 'COMFYUI_ERROR', result?.message || 'ComfyUI 请求失败', 502)
  return result
}

async function waitJob(comfy, jobId, kind) {
  for (;;) {
    const result = await callComfy(comfy, 'job', { job_id: jobId, action: 'wait', wait_s: 20 })
    if (result.status === 'running') continue
    const output = result.outputs?.find(item => item.kind === kind) || result.outputs?.[0]
    if (!output?.path) fail('NO_OUTPUT', `ComfyUI 没有返回 ${kind} 产物`, 502)
    return output.path
  }
}

async function stableCopy(source, destination, extensions) {
  const actual = await realpath(source).catch(() => null)
  const info = actual ? await stat(actual).catch(() => null) : null
  if (!info?.isFile()) fail('OUTPUT_MISSING', 'ComfyUI 产物路径不存在', 502)
  if (!extensions.includes(path.extname(actual).toLowerCase())) fail('OUTPUT_TYPE_INVALID', 'ComfyUI 产物类型不符合预期', 502)
  const extension = path.extname(actual).toLowerCase()
  const stable = path.join(path.dirname(destination), `${path.basename(destination, path.extname(destination))}${extension}`)
  await mkdir(path.dirname(stable), { recursive: true })
  await copyFile(actual, stable)
  return stable
}

function imageArgs(spec, shot, index) {
  const final = spec.profile === 'final'
  return {
    template: 'qwen-image-t2i',
    prompt: `${spec.cast_prompt}. ${shot.image_prompt}`,
    negative: spec.negative_prompt,
    width: final ? 1024 : 720,
    height: final ? 1536 : 1280,
    steps: final ? 28 : 20,
    cfg: final ? 3.5 : 2.5,
    seed: (spec.seed + index) >>> 0,
    wait_s: 0,
  }
}

function blockArgs(spec, blockIndex, imagePath) {
  const final = spec.profile === 'final'
  const shot = spec.shots[blockIndex]
  const args = {
    template: 'wan22-remix-long',
    negative: spec.negative_prompt,
    width: final ? 432 : 352,
    height: final ? 768 : 624,
    frames: final ? 65 : 49,
    fps: final ? 16 : 12,
    seed: (spec.seed + 100 + blockIndex) >>> 0,
    wait_s: 0,
  }
  for (let index = 0; index < ANCHORS_PER_BLOCK; index += 1) {
    args[`image_${index + 1}`] = imagePath
    args[`prompt_${index + 1}`] = shot.video_prompt
  }
  return args
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16000) })
    child.once('error', error => reject(new ElysiumError('PROCESS_START_FAILED', error.message, 500)))
    child.once('close', code => code === 0 ? resolve() : reject(new ElysiumError('PROCESS_FAILED', stderr.trim() || `${command} exited ${code}`, 500)))
  })
}

async function durationOf(config, file) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(String(config.ffprobe || 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => reject(new ElysiumError('FFPROBE_MISSING', error.message, 500)))
    child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new ElysiumError('FFPROBE_FAILED', stderr.trim(), 500)))
  })
  const duration = Number(output)
  if (!Number.isFinite(duration) || duration <= 0) fail('INVALID_DURATION', '无法读取成片时长', 500)
  return duration
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function assemble(config, blockPaths, destination) {
  await mkdir(path.dirname(destination), { recursive: true })
  const filter = [
    '[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v0]',
    '[1:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v1]',
    '[v0][v1]concat=n=2:v=1:a=0[outv]',
  ].join(';')
  await runProcess(String(config.ffmpeg || 'ffmpeg'), [
    '-y', '-i', blockPaths[0], '-i', blockPaths[1], '-filter_complex', filter,
    '-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-movflags', '+faststart', destination,
  ])
  return durationOf(config, destination)
}

async function generateImages(comfy, loaded) {
  const { p, spec, state } = loaded
  state.stage = 'images'
  await saveState(p, state)
  for (let index = 0; index < SHOT_COUNT; index += 1) {
    const item = state.images[index]
    if (item.status === 'ready' && item.path && await stat(item.path).catch(() => null)) continue
    item.status = 'submitting'
    item.error = null
    await saveState(p, state)
    try {
      const submitted = await callComfy(comfy, 'generate', imageArgs(spec, spec.shots[index], index))
      item.job_id = submitted.job_id
      item.status = 'running'
      await saveState(p, state)
      item.path = await stableCopy(await waitJob(comfy, submitted.job_id, 'image'), path.join(p.images, `${item.id}.png`), ['.png', '.jpg', '.jpeg', '.webp'])
      item.status = 'ready'
      addEvent(state, 'image_ready', item.id)
      await saveState(p, state)
    } catch (error) {
      item.status = 'failed'
      item.error = error.message
      await saveState(p, state)
      throw error
    }
  }
}

async function generateBlocks(comfy, loaded) {
  const { p, spec, state } = loaded
  state.stage = 'video'
  await saveState(p, state)
  for (let index = 0; index < BLOCK_COUNT; index += 1) {
    const item = state.blocks[index]
    if (item.status === 'ready' && item.path && await stat(item.path).catch(() => null)) continue
    const imagePath = state.images[index]?.path
    if (!imagePath) fail('IMAGES_REQUIRED', `${item.id} 缺少对应镜头图`, 409)
    item.status = 'submitting'
    item.error = null
    await saveState(p, state)
    try {
      const submitted = await callComfy(comfy, 'generate', blockArgs(spec, index, imagePath))
      item.job_id = submitted.job_id
      item.status = 'running'
      await saveState(p, state)
      item.path = await stableCopy(await waitJob(comfy, submitted.job_id, 'video'), path.join(p.blocks, `${item.id}.mp4`), ['.mp4', '.mov', '.webm', '.mkv'])
      item.status = 'ready'
      addEvent(state, 'block_ready', item.id)
      await saveState(p, state)
    } catch (error) {
      item.status = 'failed'
      item.error = error.message
      await saveState(p, state)
      throw error
    }
  }
}

async function makeFinal(config, loaded) {
  const { p, state } = loaded
  state.stage = 'final'
  state.final.status = 'running'
  state.final.error = null
  await saveState(p, state)
  try {
    const blockPaths = state.blocks.map(block => block.path)
    if (blockPaths.some(value => !value)) fail('BLOCKS_REQUIRED', '生成成片前必须完成两个视频块', 409)
    const destination = path.join(p.final, 'final.mp4')
    const duration = await assemble(config, blockPaths, destination)
    const qc = {
      passed: duration >= MINIMUM_DURATION_SECONDS,
      duration_seconds: Number(duration.toFixed(3)),
      minimum_duration_seconds: MINIMUM_DURATION_SECONDS,
      resolution: '720x1280',
      fps: 24,
      video_codec: 'h264',
      checked_at: now(),
    }
    const qcPath = path.join(p.final, 'qc-report.json')
    await writeJsonAtomic(qcPath, qc)
    state.final = { status: qc.passed ? 'qc_passed' : 'failed', path: destination, qc_path: qcPath, duration_seconds: qc.duration_seconds, error: qc.passed ? null : `成片时长不足 ${MINIMUM_DURATION_SECONDS} 秒` }
    if (!qc.passed) fail('QC_DURATION_FAILED', `成片时长不足 ${MINIMUM_DURATION_SECONDS} 秒`, 422)
    state.status = 'qc_passed'
    state.stage = 'review'
    addEvent(state, 'qc_passed', `成片时长 ${qc.duration_seconds} 秒`)
    await saveState(p, state)
  } catch (error) {
    state.final.status = 'failed'
    state.final.error = error.message
    await saveState(p, state)
    throw error
  }
}

async function executeRun(comfy, config, episodeId, stage) {
  const loaded = await loadEpisode(config, episodeId)
  try {
    if (stage === 'images' || stage === 'all') await generateImages(comfy, loaded)
    if (stage === 'video' || stage === 'all') await generateBlocks(comfy, loaded)
    if (stage === 'final' || stage === 'all') await makeFinal(config, loaded)
    if (stage !== 'final' && stage !== 'all') {
      loaded.state.status = 'ready'
      loaded.state.stage = stage === 'images' ? 'video' : 'final'
      addEvent(loaded.state, 'stage_completed', stage)
      await saveState(loaded.p, loaded.state)
    }
  } catch (error) {
    loaded.state.status = 'failed'
    addEvent(loaded.state, 'failed', error.message)
    await saveState(loaded.p, loaded.state)
  } finally {
    running.delete(episodeId)
  }
}

async function listEpisodes(config) {
  await mkdir(factoryRoot(config), { recursive: true })
  const specs = []
  for (const entry of await readdir(factoryRoot(config), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const loaded = await loadEpisode(config, entry.name)
      specs.push({ spec: `${entry.name}.json`, ...validateEpisodeSpec(loaded.spec), status: loaded.state.status, valid: true })
    } catch { /* malformed directories stay off the production list */ }
  }
  specs.sort((a, b) => a.episode_id.localeCompare(b.episode_id))
  return { ok: true, contract: { shots: SHOT_COUNT, blocks: BLOCK_COUNT, minimum_duration_seconds: MINIMUM_DURATION_SECONDS }, specs }
}

function requestedEpisodeId(args) {
  return safeEpisodeId(args.episode_id || String(args.spec || '').replace(/\.json$/, ''))
}

export function createFactoryService(ctx, config = {}, comfy = createComfyUiService(config)) {
  async function execute(args = {}) {
    const action = String(args.action || 'list')
    if (action === 'list') return listEpisodes(config)
    if (action === 'create') {
      const summary = validateEpisodeSpec(args.episode)
      const p = episodePaths(config, summary.episode_id)
      if (await stat(p.dir).catch(() => null)) fail('EPISODE_EXISTS', `生产单已存在：${summary.episode_id}`, 409)
      await Promise.all([mkdir(p.images, { recursive: true }), mkdir(p.blocks, { recursive: true }), mkdir(p.final, { recursive: true })])
      await writeJsonAtomic(p.spec, args.episode)
      await writeJsonAtomic(p.state, initialState(args.episode))
      return { ok: true, created: true, spec: `${summary.episode_id}.json`, summary }
    }
    const episodeId = requestedEpisodeId(args)
    const loaded = await loadEpisode(config, episodeId)
    if (action === 'check' || action === 'status' || action === 'job') {
      return { ok: true, spec: `${episodeId}.json`, contract: validateEpisodeSpec(loaded.spec), state: publicState(loaded.state) }
    }
    if (action === 'sync' || action === 'artifact') {
      const artifact = String(args.artifact || 'final')
      const file = artifact === 'final' ? loaded.state.final.path : artifact === 'qc' ? loaded.state.final.qc_path : artifact === 'review' ? loaded.state.review?.path : null
      if (!file || !(await stat(file).catch(() => null))) fail('ARTIFACT_NOT_FOUND', `${artifact} 产物尚未生成`, 404)
      return { ok: true, artifact, path: file, url: `/elysium/factory-file?episode_id=${encodeURIComponent(episodeId)}&artifact=${artifact}` }
    }
    if (action === 'approve') {
      if (args.confirm_human_review_passed !== true) fail('HUMAN_REVIEW_REQUIRED', '必须完整观看成片并明确确认人工验收通过')
      const reviewer = String(args.reviewer || '').trim()
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(reviewer)) fail('INVALID_REVIEWER', 'reviewer 只允许字母、数字、点、下划线和连字符')
      if (loaded.state.final.status !== 'qc_passed') fail('QC_REQUIRED', '只有通过时长 QC 的当前成片才能人审', 409)
      const digest = await sha256File(loaded.state.final.path)
      const review = { passed: true, reviewer, reviewed_at: now(), final_sha256: digest }
      const reviewPath = path.join(loaded.p.final, 'human-review.json')
      await writeJsonAtomic(reviewPath, review)
      loaded.state.review = { ...review, path: reviewPath }
      loaded.state.status = 'approved'
      loaded.state.stage = 'approved'
      addEvent(loaded.state, 'approved', reviewer)
      await saveState(loaded.p, loaded.state)
      return { ok: true, state: publicState(loaded.state) }
    }
    if (action === 'retry') {
      if (running.has(episodeId)) fail('PIPELINE_BUSY', '生产运行中，不能重置产物', 409)
      const target = String(args.target || '')
      const image = loaded.state.images.find(item => item.id === target)
      const block = loaded.state.blocks.find(item => item.id === target)
      if (!image && !block && target !== 'final') fail('INVALID_RETRY_TARGET', 'target 必须是 shot-01、shot-02、block-01、block-02 或 final')
      if (image) {
        Object.assign(image, { status: 'pending', job_id: null, path: null, error: null })
        Object.assign(loaded.state.blocks[loaded.state.images.indexOf(image)], { status: 'pending', job_id: null, path: null, error: null })
      }
      if (block) Object.assign(block, { status: 'pending', job_id: null, path: null, error: null })
      loaded.state.final = { status: 'pending', path: null, qc_path: null, duration_seconds: null, error: null }
      loaded.state.review = null
      loaded.state.status = 'ready'
      addEvent(loaded.state, 'retry_reset', target)
      await saveState(loaded.p, loaded.state)
      return { ok: true, state: publicState(loaded.state) }
    }
    if (action !== 'run') fail('INVALID_ACTION', 'action 必须是 list、create、check、status、run、job、retry、artifact、sync 或 approve')
    if (args.confirm_authorized_adults !== true) fail('ADULTS_CONFIRMATION_REQUIRED', '付费生成前必须确认角色均为已授权的虚构成年人、内容自愿且素材权利清晰')
    const stage = String(args.stage || 'all')
    if (!['images', 'video', 'final', 'all'].includes(stage)) fail('INVALID_STAGE', 'stage 必须是 images、video、final 或 all')
    if (running.has(episodeId)) fail('PIPELINE_BUSY', `生产任务正在运行：${running.get(episodeId)}`, 409)
    const jobId = `elysium-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    running.set(episodeId, jobId)
    loaded.state.status = 'running'
    loaded.state.stage = stage
    loaded.state.job_id = jobId
    addEvent(loaded.state, 'run_started', stage)
    await saveState(loaded.p, loaded.state)
    void executeRun(comfy, config, episodeId, stage)
    return { ok: true, accepted: true, job: { id: jobId, episode_id: episodeId, status: 'running', stage } }
  }
  return { execute }
}

export async function serveFactoryArtifact(req, res, config = {}) {
  try {
    const url = new URL(req.url || '/', 'http://elysium.internal')
    const episodeId = safeEpisodeId(url.searchParams.get('episode_id'))
    const artifact = String(url.searchParams.get('artifact') || 'final')
    const loaded = await loadEpisode(config, episodeId)
    const file = artifact === 'final' ? loaded.state.final.path : artifact === 'qc' ? loaded.state.final.qc_path : artifact === 'review' ? loaded.state.review?.path : null
    if (!file) fail('ARTIFACT_NOT_FOUND', '产物尚未生成', 404)
    const info = await stat(file)
    if (!info.isFile()) fail('ARTIFACT_NOT_FOUND', '产物尚未生成', 404)
    const type = artifact === 'final' ? 'video/mp4' : 'application/json; charset=utf-8'
    const range = req.headers?.range
    if (artifact === 'final' && range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      const start = match?.[1] ? Number(match[1]) : 0
      const end = match?.[2] ? Number(match[2]) : info.size - 1
      if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= info.size) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` })
        return res.end()
      }
      res.writeHead(206, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': end - start + 1,
        'cache-control': 'no-store',
      })
      return createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'accept-ranges': artifact === 'final' ? 'bytes' : 'none', 'cache-control': 'no-store' })
    return createReadStream(file).pipe(res)
  } catch (error) {
    res.writeHead(error?.status || 500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, code: error?.code || 'ARTIFACT_ERROR', error: error?.message || 'Internal error' }))
  }
}
