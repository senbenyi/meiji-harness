import { readFile, writeFile } from 'node:fs/promises'
import { resolveConfig, withConfig } from '../src/config.js'
import { startVideoJob, resumeVideoJob } from '../src/workflows/video-jobs.js'
import { waitJob } from '../src/jobs/wait.js'

const [requestPath, receiptPath] = process.argv.slice(2)
if (!requestPath || !receiptPath) throw new Error('Usage: COMFYUI_URL=... node scripts/preview-shot.mjs request.json receipt.json')
const request = JSON.parse(await readFile(requestPath, 'utf8'))
if (request.profile !== 'preview') throw new Error('This entry requires profile=preview')
const saved = await readFile(receiptPath, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error })
if (saved && JSON.stringify(saved.request) !== JSON.stringify(request)) throw new Error('Receipt belongs to another shot; use its original request')
await withConfig(resolveConfig(), async () => {
  const job = saved ? await resumeVideoJob(saved.job_id) : await startVideoJob(request)
  await writeFile(receiptPath, JSON.stringify({ request, job_id: job.job_id }, null, 2))
  console.log(JSON.stringify(job))
  const result = await waitJob(job)
  await writeFile(receiptPath, JSON.stringify({ request, job_id: job.job_id, result }, null, 2))
  console.log(JSON.stringify(result))
  if (result.status !== 'succeeded') process.exitCode = 1
})
