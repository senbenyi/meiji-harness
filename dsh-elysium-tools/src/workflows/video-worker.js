import { requiredConfig } from '../config.js'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, saveJson } from '../functions/comfyui/client.js'
import { executeComfyMedia } from './media-execution.js'
import { executeVideoWorkflowJob } from '../functions/common/task.js'

const jobId = process.argv[2]
if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new Error('Invalid job ID')
const directory = join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', jobId)
try {
  const request = JSON.parse(await readFile(join(directory, 'input/request.json'), 'utf8'))
  if (request.capability) await executeComfyMedia(jobId, request)
  else await executeVideoWorkflowJob(jobId, request)
} catch (error) {
  const statusPath = join(directory, 'status.json')
  const status = await readJson(statusPath) || { job_id: jobId }
  if (status.status !== 'failed') await saveJson(statusPath, { ...status, status: 'failed', stage: 'failed', error_code: 'MODEL_GENERATION_FAILED', error: error.message })
  console.error(error.message)
  process.exitCode = 1
} finally {
  await unlink(join(directory, 'worker.lock')).catch(() => {})
}
