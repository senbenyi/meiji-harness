// 职责：作为独立进程执行一个视频任务并写入最终状态。
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, saveJson } from '../jobs/store.js'
import { projectJobRoot, validJobId, validProjectId } from '../jobs/paths.js'
import { executeComfyVideo } from './execution.js'

const projectId = process.argv[2], jobId = process.argv[3]
if (!validProjectId(projectId) || !validJobId(jobId)) throw new Error('Invalid project or job ID')
const directory = projectJobRoot(projectId, jobId)
const controller = new AbortController()
for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort(
  Object.assign(new Error('本地处理已停止；远端任务未取消，恢复时核对原 prompt_id'), { code: 'LOCAL_WORKER_STOPPED' })))
try {
  const request = JSON.parse(await readFile(join(directory, 'input/request.json'), 'utf8'))
  await executeComfyVideo(projectId, jobId, request, { signal: controller.signal })
} catch (error) {
  const statusPath = join(directory, 'status.json')
  const status = await readJson(statusPath) || { job_id: jobId, project_id: projectId }
  if (status.status !== 'failed') await saveJson(statusPath, { ...status, status: 'failed', stage: 'failed', error_code: 'MODEL_GENERATION_FAILED', error: error.message })
  console.error(error.message)
  process.exitCode = 1
} finally {
  await unlink(join(directory, 'worker.lock')).catch(() => {})
}
