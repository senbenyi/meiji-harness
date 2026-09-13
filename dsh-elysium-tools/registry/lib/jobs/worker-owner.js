import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { ModelTaskError } from './contracts.js'
const run = promisify(execFile)

export async function workerAlive(lockPath, jobId) {
  let text
  try { text = await readFile(lockPath, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  const pid = Number(text)
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
  return alive
}
