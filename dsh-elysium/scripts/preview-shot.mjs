// 职责：提交或恢复单镜头预览任务，并等待任务完成。
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveConfig, withConfig, requiredConfig } from '../src/config.js'
import { withLaunchLock } from '../src/jobs/lock.js'
import { executeVideoShot } from '../src/video-production/runner.js'

const [requestPath, receiptPath] = process.argv.slice(2)
if (!requestPath || !receiptPath) throw new Error('Usage: COMFYUI_URL=... node scripts/preview-shot.mjs request.json receipt.json')
const request = JSON.parse(await readFile(requestPath, 'utf8'))
if (request.profile !== 'preview') throw new Error('This entry requires profile=preview')
await withConfig(resolveConfig(), async () => {
  const guard = `${resolve(receiptPath)}.lock`
  await mkdir(guard, { recursive: true })
  await withLaunchLock(guard, async () => {
    requiredConfig('COMFYUI_URL', 'url')
    const receipt = await executeVideoShot(request, receiptPath)
    console.log(JSON.stringify(receipt.result))
    if (receipt.result.status !== 'succeeded') process.exitCode = 1
  })
})
