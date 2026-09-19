// 职责：worker 独立进程入口：解析任务身份、转发停止信号，执行结束后释放 worker 锁。
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { jobRoot, validJobId, validProjectId } from '../store/paths.js'
import { executeTask } from './execute.js'

const projectId = process.argv[2], jobId = process.argv[3]
if (!validProjectId(projectId) || !validJobId(jobId)) throw new Error('Invalid project or job ID')
const controller = new AbortController()
for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort(
  Object.assign(new Error('本地处理已停止；远端任务未取消，恢复时核对原 prompt_id'), { code: 'LOCAL_WORKER_STOPPED' })))
try {
  await executeTask(projectId, jobId, { signal: controller.signal })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await unlink(join(jobRoot(jobId), 'worker.lock')).catch(() => {})
}
