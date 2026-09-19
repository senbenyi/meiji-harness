// 职责：核验 worker 锁中的进程是否仍属于指定生成任务。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { ModelTaskError } from '../../utils/errors.js'
const run = promisify(execFile)
// worker 入口脚本；旧路径保留识别，升级前启动的 worker 不会被误判为已停止。
const WORKER_SCRIPTS = ['/worker/runner/process.js', '/worker/tasks/runtime/worker.js']

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
        alive = argv.some((arg, index) => WORKER_SCRIPTS.some(script => arg.endsWith(script)) && argv[index + 2] === jobId)
      } else {
        // macOS 默认按终端宽度截断 command，任务 ID 位于长路径之后，必须读取完整命令行。
        const { stdout } = await run('ps', ['-ww', '-p', String(pid), '-o', 'command='], { timeout: 5000 })
        alive = WORKER_SCRIPTS.some(script => new RegExp(`${script.replaceAll('.', '\\.')}\\s+[^\\s]+\\s+${jobId}(?:\\s|$)`).test(stdout))
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

export async function stopWorker(lockPath, jobId, { timeout = 5000 } = {}) {
  if (!await workerAlive(lockPath, jobId)) return
  const pid = Number(await readFile(lockPath, 'utf8'))
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (!await workerAlive(lockPath, jobId)) return
  }
  throw new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '原 worker 未能安全停止，未重新派发任务', 409)
}
