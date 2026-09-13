// 职责：在锁保护下启动或接管本地视频 worker。
import { requiredConfig, workerEnvironment } from '../config.js'
import { spawn } from 'node:child_process'
import { open, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerAlive } from './worker-owner.js'
import { getJob } from '../jobs/query.js'
import { withLaunchLock } from '../jobs/lock.js'
import { saveJson } from '../jobs/store.js'

const stateRoot = () => requiredConfig('ELYSIUM_STATE_ROOT')
const writeStatus = (directory, value) => saveJson(join(directory, 'status.json'), value)

export async function launch(jobId, capability = 'workflow-video', retryFailed = false) {
  const directory = join(stateRoot(), 'jobs', jobId)
  return withLaunchLock(directory, () => launchLocked(jobId, capability, retryFailed))
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
      const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url)), jobId],
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
