// 职责：读取生产清单，并执行批量视频生产任务。
import { resolve } from 'node:path'
import { resolveConfig, withConfig } from '../src/config.js'
import { loadProductionManifest } from '../src/video-production/manifest.js'
import { runProduction } from '../src/video-production/runner.js'

const [manifestArgument, limitArgument] = process.argv.slice(2)
if (!manifestArgument) throw new Error('用法：node scripts/production-runner.mjs <manifest.json> [limit]')
const manifest = await loadProductionManifest(resolve(manifestArgument))
const limit = limitArgument === undefined ? manifest.shots.length : Number(limitArgument)
const controller = new AbortController()
process.once('SIGINT', () => controller.abort(new Error('收到 SIGINT')))
process.once('SIGTERM', () => controller.abort(new Error('收到 SIGTERM')))

await withConfig(resolveConfig(), async () => {
  const result = await runProduction(manifest, { limit, signal: controller.signal })
  console.log(JSON.stringify(result, null, 2))
})
