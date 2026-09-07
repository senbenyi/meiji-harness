import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { executeVideoWorkflowJob } from '../functions/common/task.js'

const jobId = process.argv[2]
if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new Error('Invalid job ID')
const directory = join(process.env.ELYSIUM_TOOLS_STATE_ROOT || '/root/autodl-tmp/elysium-tools', 'jobs', jobId)
try {
  const request = JSON.parse(await readFile(join(directory, 'input/request.json'), 'utf8'))
  await executeVideoWorkflowJob(jobId, request)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await unlink(join(directory, 'worker.lock')).catch(() => {})
}
