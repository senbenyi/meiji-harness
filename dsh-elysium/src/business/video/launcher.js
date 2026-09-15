// 职责：在锁保护下启动或接管本地视频 worker。
import { connectBackend } from '../../servers/runtime.js'
import { readBackend } from '../../servers/backend.js'
import { workerEnvironment } from '../../config.js'
import { spawn } from 'node:child_process'
import { open, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerAlive } from './worker-owner.js'
import { getJob } from '../jobs/query.js'
import { withLaunchLock } from '../jobs/lock.js'
import { saveJson } from '../jobs/store.js'
import { findJobRoot } from '../jobs/paths.js'

const writeStatus = (directory, value) => saveJson(join(directory, 'status.json'), value)

export async function launch(jobId, capability = 'workflow-video', retryFailed = false) {
  const located = await findJobRoot(jobId)
  if (!located) throw new Error('任务不存在')
  const directory = located.directory
  return withLaunchLock(directory, () => launchLocked(jobId, capability, retryFailed))
}

async function launchLocked(jobId, capability, retryFailed) {
  const located = await findJobRoot(jobId)
  if (!located) throw new Error('任务不存在')
  const { directory, projectId } = located
  const backend = await readBackend(directory)
  const lockPath = join(directory, 'worker.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const alive = await workerAlive(lockPath, jobId)
    if (alive) return { job_id: jobId, project_id: projectId, status: (await getJob(jobId)).status }
    // Only a confirmed dead owner is reclaimed. The submission journal still
    // decides whether to query the original prompt, recover a lost POST, or stop.
    await unlink(lockPath)
    lock = await open(lockPath, 'wx', 0o600)
  }
  try {
    await connectBackend(backend)
    if (retryFailed) await writeFile(join(directory, 'resume-request.json'), JSON.stringify({ retry_failed: true }), { mode: 0o600 })
    await writeStatus(directory, { job_id: jobId, project_id: projectId, capability, backend: 'comfyui', server: backend, status: 'queued', stage: 'queued' })
    const log = await open(join(directory, 'worker.log'), 'a')
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url)), projectId, jobId],
        { detached: true, stdio: ['ignore', log.fd, log.fd], env: workerEnvironment() })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      await lock.writeFile(String(child.pid))
      child.unref()
    } finally { await log.close() }
    return { job_id: jobId, project_id: projectId, status: 'queued' }
  } catch (error) {
    await writeStatus(directory, { job_id: jobId, project_id: projectId, capability, backend: 'comfyui', server: backend, status: 'failed', error_code: error.code, error: error.message })
    await unlink(lockPath).catch(() => {})
    throw error
  } finally { await lock.close() }
}
