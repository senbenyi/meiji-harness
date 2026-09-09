import { requiredConfig, runtimeConfig, workerEnvironment } from '../config.js'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { open, readFile, stat, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getJob } from './query.js'
import { ModelTaskError } from './contracts.js'
import { saveJson } from './json.js'

const stateRoot = () => requiredConfig('ELYSIUM_TOOLS_STATE_ROOT')
const run = promisify(execFile)
const writeStatus = (directory, value) => saveJson(join(directory, 'status.json'), value)

export async function launch(jobId, capability = 'workflow-video', retryFailed = false) {
  const directory = join(stateRoot(), 'jobs', jobId)
  return withLaunchLock(directory, () => launchLocked(jobId, capability, retryFailed))
}

export async function withLaunchLock(directory, callback) {
  const guard = spawn(runtimeConfig().HARNESS_PYTHON || process.env.PYTHON_BIN || 'python3',
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
    return await callback()
  } finally { guard.stdin.end(); await closed }
}

async function launchLocked(jobId, capability, retryFailed) {
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
    if (retryFailed) await writeFile(join(directory, 'resume-request.json'), JSON.stringify({ retry_failed: true }), { mode: 0o600 })
    await writeStatus(directory, { job_id: jobId, capability, backend: 'comfyui', status: 'queued', stage: 'queued' })
    const log = await open(join(directory, 'worker.log'), 'a')
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../workflows/video-worker.js', import.meta.url)), jobId],
        { detached: true, stdio: ['ignore', log.fd, log.fd], env: workerEnvironment() })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      await lock.writeFile(String(child.pid))
      child.unref()
    } finally { await log.close() }
    return { job_id: jobId, status: 'queued' }
  } catch (error) {
    await writeStatus(directory, { job_id: jobId, capability, backend: 'comfyui', status: 'failed', error: error.message })
    await unlink(lockPath).catch(() => {})
    throw error
  } finally { await lock.close() }
}
