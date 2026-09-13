import { requiredConfig, workerEnvironment } from '../config.js'
import { spawn } from 'node:child_process'
import { mkdir, open, readFile, rm, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { workerAlive } from './worker-owner.js'
import { getJob } from './query.js'
import { ModelTaskError } from './contracts.js'
import { saveJson } from './json.js'

const stateRoot = () => requiredConfig('ELYSIUM_TOOLS_STATE_ROOT')
const writeStatus = (directory, value) => saveJson(join(directory, 'status.json'), value)

export async function launch(jobId, capability = 'workflow-video', retryFailed = false) {
  const directory = join(stateRoot(), 'jobs', jobId)
  return withLaunchLock(directory, () => launchLocked(jobId, capability, retryFailed))
}

export async function withLaunchLock(directory, callback, wait = false) {
  const lock = join(directory, 'launch.lock')
  const token = `${process.pid}:${randomUUID()}`
  try {
    await acquireLaunchLock(lock, token, wait)
    return await callback()
  } finally {
    if (await readFile(join(lock, 'owner'), 'utf8').catch(() => '') === token) await rm(lock, { recursive: true })
  }
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const processAlive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function acquireLaunchLock(lock, token, wait) {
  for (;;) {
    try {
      await mkdir(lock)
      try { await writeFile(join(lock, 'owner'), token, { mode: 0o600 }) }
      catch (error) { await rm(lock, { recursive: true, force: true }); throw error }
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const owner = await readFile(join(lock, 'owner'), 'utf8').catch(() => '')
    const pid = Number(owner.split(':', 1)[0])
    if (Number.isInteger(pid) && processAlive(pid)) {
      if (wait) { await pause(50); continue }
      throw new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '任务正在启动，请稍后查询原任务', 409)
    }
    const stale = `${lock}.stale-${randomUUID()}`
    try { await rename(lock, stale); await rm(stale, { recursive: true }) } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error
    }
  }
}

async function launchLocked(jobId, capability, retryFailed) {
  const directory = join(stateRoot(), 'jobs', jobId)
  const lockPath = join(directory, 'worker.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const alive = await workerAlive(lockPath, jobId)
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
