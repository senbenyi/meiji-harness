// 职责：作为独立进程执行一个视频任务并写入最终状态。
import { requiredConfig } from '../config.js'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, saveJson } from '../jobs/store.js'
import { executeComfyVideo } from './execution.js'

const jobId = process.argv[2]
if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new Error('Invalid job ID')
const directory = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'jobs', jobId)
const controller = new AbortController()
for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort(
  Object.assign(new Error('本地处理已停止；远端任务未取消，恢复时核对原 prompt_id'), { code: 'LOCAL_WORKER_STOPPED' })))
try {
  const request = JSON.parse(await readFile(join(directory, 'input/request.json'), 'utf8'))
  await executeComfyVideo(jobId, request, { signal: controller.signal })
} catch (error) {
  const statusPath = join(directory, 'status.json')
  const status = await readJson(statusPath) || { job_id: jobId }
  if (status.status !== 'failed') await saveJson(statusPath, { ...status, status: 'failed', stage: 'failed', error_code: 'MODEL_GENERATION_FAILED', error: error.message })
  console.error(error.message)
  process.exitCode = 1
} finally {
  await unlink(join(directory, 'worker.lock')).catch(() => {})
}
