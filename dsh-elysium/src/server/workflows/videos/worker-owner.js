// 职责：核验 worker 锁中的进程是否仍属于指定视频任务。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { ModelTaskError } from '../../jobs/errors.js'
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
        alive = argv.some((arg, index) => arg.endsWith('/server/workflows/videos/worker.js') && argv[index + 2] === jobId)
      } else {
        // macOS 默认按终端宽度截断 command，任务 ID 位于长路径之后，必须读取完整命令行。
        const { stdout } = await run('ps', ['-ww', '-p', String(pid), '-o', 'command='], { timeout: 5000 })
        alive = new RegExp(`/server/workflows/videos/worker\\.js\\s+[^\\s]+\\s+${jobId}(?:\\s|$)`).test(stdout)
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
