// 职责：提交或恢复单镜头预览任务，并等待任务完成。
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { resolveConfig, withConfig, requiredConfig } from '../src/config.js'
import { resumeVideoJob } from '../src/video/service.js'
import { validateVideoPlan } from '../src/video/plan.js'
import { createJob } from '../src/jobs/create.js'
import { launch } from '../src/video/launcher.js'
import { withLaunchLock } from '../src/jobs/lock.js'
import { readJson, saveJson } from '../src/jobs/store.js'
import { waitJob } from '../src/jobs/wait.js'

const [requestPath, receiptPath] = process.argv.slice(2)
if (!requestPath || !receiptPath) throw new Error('Usage: COMFYUI_URL=... node scripts/preview-shot.mjs request.json receipt.json')
const request = JSON.parse(await readFile(requestPath, 'utf8'))
if (request.profile !== 'preview') throw new Error('This entry requires profile=preview')
await withConfig(resolveConfig(), async () => {
  const guard = `${resolve(receiptPath)}.lock`
  await mkdir(guard, { recursive: true })
  await withLaunchLock(guard, async () => {
    const saved = await readJson(receiptPath)
    if (saved && JSON.stringify(saved.request) !== JSON.stringify(request)) throw new Error('Receipt belongs to another shot; use its original request')
    await validateVideoPlan(request)
    requiredConfig('COMFYUI_URL', 'url')
    const jobId = saved?.job_id || await createJob(request)
    // Persist identity before starting a worker: interrupted submissions retain the same job.
    if (!saved) await saveJson(receiptPath, { request, job_id: jobId })
    const status = await readJson(join(requiredConfig('ELYSIUM_STATE_ROOT'), 'jobs', jobId, 'status.json'))
    const job = status ? await resumeVideoJob(jobId) : await launch(jobId)
    console.log(JSON.stringify(job))
    const result = await waitJob(job)
    await saveJson(receiptPath, { request, job_id: jobId, result })
    console.log(JSON.stringify(result))
    if (result.status !== 'succeeded') process.exitCode = 1
  })
})
