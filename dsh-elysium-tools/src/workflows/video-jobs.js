import { requiredConfig } from '../config.js'
import { randomBytes } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, open, readFile, realpath, stat, writeFile, unlink, rename } from 'node:fs/promises'
import { isAbsolute, join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getJob, ModelTaskError } from '../functions/common/task.js'
import { bindVideoCall } from '../jobs/call-index.js'

const stateRoot = () => requiredConfig('ELYSIUM_TOOLS_STATE_ROOT')
const artifactsRoot = () => requiredConfig('ARTIFACTS_ROOT')
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
const run = promisify(execFile)

async function writeStatus(directory, value) {
  const path = join(directory, 'status.json')
  await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export async function validateVideoPlan(args) {
  const allowed = new Set(['duration', 'shots', 'prompts', 'image_path', 'image_prompt', 'video_paths', 'seed'])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid('包含未支持的工作流参数')
  if (!Number.isInteger(args.duration) || args.duration < 1) throw invalid('duration 必须为正整数总秒数')
  if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2 ** 32 - 1)) throw invalid('seed 必须为 uint32')
  if (args.shots !== undefined) {
    if (['prompts', 'image_path', 'image_prompt', 'video_paths'].some(k => k in args)) throw invalid('shots 不能与旧参数混用；素材必须绑定到对应镜头')
    return validateShots(args.shots, args.duration)
  }
  const clips = args.video_paths
  if (clips !== undefined) {
    if (!Array.isArray(clips) || !clips.length || args.prompts !== undefined || args.image_prompt !== undefined || args.image_path !== undefined) throw invalid('已有视频列表不能为空，且不能与生成输入混用')
  } else {
    if (!Array.isArray(args.prompts) || !args.prompts.length || args.prompts.some(p => typeof p !== 'string' || !p.trim())) throw invalid('提供非空分镜提示词列表')
    if (args.duration <= 15 ? args.prompts.length !== 1 : args.prompts.length < 2 || args.duration < args.prompts.length || args.duration > args.prompts.length * 15) throw invalid('多镜头请使用 shots 明确各镜时长；不得缩短总时长或删减镜头以绕过校验')
    if (args.image_prompt !== undefined && (typeof args.image_prompt !== 'string' || !args.image_prompt.trim())) throw invalid('image_prompt 不能为空')
    if ('image_path' in args && 'image_prompt' in args) throw invalid('image_path 与 image_prompt 二选一')
    if (args.duration > 15 && !args.image_path && !args.image_prompt) throw invalid('长视频需要首帧或首帧提示词')
  }
  const root = await realpath(artifactsRoot())
  for (const value of [...(clips || []), ...('image_path' in args ? [args.image_path] : [])]) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw invalid('素材必须为绝对路径')
    const path = await realpath(value).catch(() => { throw invalid('素材文件不存在') })
    const rel = relative(root, path)
    const suffixes = clips ? ['.mp4'] : ['.png', '.jpg', '.jpeg', '.webp']
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !suffixes.includes(extname(path).toLowerCase()) || !(await stat(path)).isFile()) throw invalid('素材须为 artifacts 内的有效图片或 MP4')
  }
}

async function validateShots(shots, duration) {
  if (!Array.isArray(shots) || !shots.length) throw invalid('shots 必须为非空镜头列表')
  const root = await realpath(artifactsRoot())
  const ids = new Set()
  const mediaTypes = { image_path: ['.png', '.jpg', '.jpeg', '.webp'], video_path: ['.mp4', '.mov', '.webm', '.mkv'], audio_path: ['.wav', '.mp3', '.flac', '.m4a', '.ogg'] }
  for (const [index, shot] of shots.entries()) {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot) || Object.keys(shot).some(k => !['id', 'duration', 'mode', 'prompt', 'seed', 'in_point', ...Object.keys(mediaTypes)].includes(k))) throw invalid('镜头包含未支持的字段')
    if (typeof shot.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(shot.id) || ids.has(shot.id)) throw invalid('镜号须为唯一的 1..48 位字母、数字、下划线或连字符')
    ids.add(shot.id)
    const mode = shot.mode === undefined ? 'independent' : shot.mode
    if (!['independent', 'reference', 'continue', 'reuse'].includes(mode)) throw invalid('镜头 mode 无效')
    if (!Number.isInteger(shot.duration) || shot.duration < 1 || (mode !== 'reuse' && shot.duration > 15)) throw invalid('生成镜头须为 1..15 秒，复用镜头须为正整数秒')
    if ('seed' in shot && (!Number.isInteger(shot.seed) || shot.seed < 0 || shot.seed > 2 ** 32 - 1)) throw invalid('镜头 seed 必须为 uint32')
    const media = Object.keys(mediaTypes).filter(k => k in shot)
    if (mode === 'reuse') {
      if (media.length !== 1 || media[0] !== 'video_path' || 'prompt' in shot || 'seed' in shot) throw invalid('reuse 仅接受已有 video_path，不接受提示词或种子')
    } else {
      if (typeof shot.prompt !== 'string' || !shot.prompt.trim()) throw invalid('生成镜头必须提供原始完整 prompt')
      if ('in_point' in shot) throw invalid('in_point 仅用于复用素材剪辑')
      if (mode === 'independent' && media.some(k => k !== 'image_path')) throw invalid('音视频参考请使用 reference')
      if (mode === 'reference' && !media.length) throw invalid('reference 至少需要一项真实参考素材')
      if (mode === 'continue' && (index === 0 || media.length)) throw invalid('continue 必须跟随前镜头，且不能混入其他参考素材')
    }
    if ('in_point' in shot && (typeof shot.in_point !== 'number' || !Number.isFinite(shot.in_point) || shot.in_point < 0)) throw invalid('in_point 必须为非负有限秒数')
    for (const kind of media) {
      if (typeof shot[kind] !== 'string' || !isAbsolute(shot[kind])) throw invalid(`${kind} 必须为绝对路径`)
      const path = await realpath(shot[kind]).catch(() => { throw invalid('素材文件不存在') })
      const rel = relative(root, path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || !mediaTypes[kind].includes(extname(path).toLowerCase()) || !(await stat(path)).isFile()) throw invalid(`${kind} 必须为 artifacts 内支持类型的素材`)
    }
  }
  if (shots.reduce((sum, s) => sum + s.duration, 0) !== duration) throw invalid('镜头时长之和必须等于 duration；不得自动缩短或删减镜头')
}

export async function startVideoJob(args, exec) {
  await validateVideoPlan(args)
  const jobId = randomBytes(16).toString('hex')
  const directory = join(stateRoot(), 'jobs', jobId)
  await mkdir(join(directory, 'input'), { recursive: true })
  await writeFile(join(directory, 'input/request.json'), JSON.stringify(args), { mode: 0o600 })
  await bindVideoCall(jobId, exec)
  return launch(jobId)
}

export async function resumeVideoJob(jobId, exec) {
  const job = await getJob(jobId)
  if (job.capability !== 'workflow-video') throw invalid('只能恢复视频工作流；原子产物请按顺序导入新工作流')
  await bindVideoCall(jobId, exec)
  if (job.status === 'succeeded') return { job_id: jobId, status: job.status }
  if (job.status === 'failed' && job.backend === 'comfyui') {
    await writeFile(join(stateRoot(), 'jobs', jobId, 'resume-request.json'), JSON.stringify({ retry_failed: true }), { mode: 0o600 })
  }
  return launch(jobId)
}

export async function launch(jobId, capability = 'workflow-video') {
  const directory = join(stateRoot(), 'jobs', jobId)
  const guard = spawn(process.env.HARNESS_PYTHON || process.env.PYTHON_BIN || 'python3',
    [fileURLToPath(new URL('./launch-lock.py', import.meta.url)), join(directory, 'launch.lock')],
    { stdio: ['pipe', 'pipe', 'pipe'] })
  const closed = new Promise(resolve => { guard.once('close', resolve) })
  guard.stdin.on('error', () => {})
  guard.stderr.resume()
  try {
    await new Promise((resolve, reject) => {
      guard.once('error', reject)
      guard.once('exit', () => reject(new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '任务正在启动或启动锁不可用，请稍后查询原任务', 409)))
      guard.stdout.once('data', resolve)
    })
    return await launchLocked(jobId, capability)
  } finally { guard.stdin.end(); await closed }
}

async function launchLocked(jobId, capability) {
  const directory = join(stateRoot(), 'jobs', jobId)
  const lockPath = join(directory, 'worker.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(lockPath, 'utf8'))
    let alive = true
    try {
      if (!Number.isInteger(pid) || pid <= 0) {
        if (Date.now() - (await stat(lockPath)).mtimeMs < 60_000) throw new Error('worker starting')
        alive = false
      } else {
        process.kill(pid, 0)
        if (process.platform === 'linux') {
          const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')
          alive = argv.some((arg, index) => arg.endsWith('/video-worker.js') && argv[index + 1] === jobId)
        } else {
          const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command='], { timeout: 5000 })
          alive = stdout.includes(`/video-worker.js ${jobId}`)
        }
      }
    } catch (error) {
      let gone = error.code === 'ESRCH'
      if (!gone && Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) } catch (probeError) { gone = probeError.code === 'ESRCH' }
      }
      if (gone) alive = false
      else throw new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '原 worker 身份未确认，暂不接管任务', 409)
    }
    if (alive) return { job_id: jobId, status: (await getJob(jobId)).status }
    // Only a confirmed dead owner is reclaimed. The submission journal still
    // decides whether to query the original prompt, recover a lost POST, or stop.
    await unlink(lockPath)
    lock = await open(lockPath, 'wx', 0o600)
  }
  try {
    await writeStatus(directory, { job_id: jobId, capability, status: 'queued', stage: 'queued' })
    const log = await open(join(directory, 'worker.log'), 'a')
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./video-worker.js', import.meta.url)), jobId],
        { detached: true, stdio: ['ignore', log.fd, log.fd], env: process.env })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      await lock.writeFile(String(child.pid))
      child.unref()
    } finally { await log.close() }
    return { job_id: jobId, status: 'queued' }
  } catch (error) {
    await writeStatus(directory, { job_id: jobId, capability, status: 'failed', error: error.message })
    await unlink(lockPath).catch(() => {})
    throw error
  } finally { await lock.close() }
}
