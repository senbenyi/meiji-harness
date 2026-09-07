import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, open, readFile, realpath, stat, writeFile, unlink, rename } from 'node:fs/promises'
import { isAbsolute, join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getJob, ModelTaskError } from '../functions/common/task.js'
import { bindVideoCall } from '../jobs/call-index.js'

const stateRoot = process.env.ELYSIUM_TOOLS_STATE_ROOT || '/root/autodl-tmp/elysium-tools'
const artifactsRoot = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects'
const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', message, 422)

async function writeStatus(directory, value) {
  const path = join(directory, 'status.json')
  await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export async function validateVideoPlan(args) {
  const allowed = new Set(['duration', 'prompts', 'image_path', 'image_prompt', 'video_paths', 'seed'])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid('包含未支持的工作流参数')
  if (!Number.isInteger(args.duration) || args.duration < 1) throw invalid('duration 必须为正整数总秒数')
  if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2 ** 32 - 1)) throw invalid('seed 必须为 uint32')
  const clips = args.video_paths
  if (clips !== undefined) {
    if (!Array.isArray(clips) || !clips.length || args.prompts !== undefined || args.image_prompt !== undefined || args.image_path !== undefined) throw invalid('已有视频列表不能为空，且不能与生成输入混用')
  } else {
    if (!Array.isArray(args.prompts) || !args.prompts.length || args.prompts.some(p => typeof p !== 'string' || !p.trim())) throw invalid('提供非空分镜提示词列表')
    if (args.duration <= 15 ? args.prompts.length !== 1 : args.prompts.length < 2 || args.duration < args.prompts.length || args.duration > args.prompts.length * 15) throw invalid('短视频一条提示词；长视频至少两条且每段 1..15 秒')
    if (args.image_prompt !== undefined && (typeof args.image_prompt !== 'string' || !args.image_prompt.trim())) throw invalid('image_prompt 不能为空')
    if (args.image_path && args.image_prompt) throw invalid('image_path 与 image_prompt 二选一')
    if (args.duration > 15 && !args.image_path && !args.image_prompt) throw invalid('长视频需要首帧或首帧提示词')
  }
  const root = await realpath(artifactsRoot)
  for (const value of [...(clips || []), ...(args.image_path ? [args.image_path] : [])]) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw invalid('素材必须为绝对路径')
    const path = await realpath(value).catch(() => { throw invalid('素材文件不存在') })
    const rel = relative(root, path)
    const suffixes = clips ? ['.mp4'] : ['.png', '.jpg', '.jpeg', '.webp']
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !suffixes.includes(extname(path).toLowerCase()) || !(await stat(path)).isFile()) throw invalid('素材须为 artifacts 内的有效图片或 MP4')
  }
}

export async function startVideoJob(args, exec) {
  await validateVideoPlan(args)
  const jobId = randomBytes(16).toString('hex')
  const directory = join(stateRoot, 'jobs', jobId)
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
  return launch(jobId)
}

async function launch(jobId) {
  const directory = join(stateRoot, 'jobs', jobId)
  const lockPath = join(directory, 'worker.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(lockPath, 'utf8'))
    try {
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('worker starting')
      process.kill(pid, 0)
    } catch {
      throw new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '任务锁存在但进程未确认存活；先核对原任务与 ComfyUI 队列，不能重复提交', 409)
    }
    return { job_id: jobId, status: (await getJob(jobId)).status }
  }
  try {
    await writeStatus(directory, { job_id: jobId, capability: 'workflow-video', status: 'queued', stage: 'queued' })
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
    await writeStatus(directory, { job_id: jobId, capability: 'workflow-video', status: 'failed', error: error.message })
    await unlink(lockPath).catch(() => {})
    throw error
  } finally { await lock.close() }
}
