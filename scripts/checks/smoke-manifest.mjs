/** Elysium 活动工作流清单冒烟测试；纯静态，不访问 ComfyUI。 */
process.env.DSH_SVS_CONFIG = process.env.DSH_SVS_CONFIG || '/nonexistent/svs-smoke-config.json'

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync } from 'node:fs'
import { loadBuiltinManifests, buildGraphFromManifest } from '../../lib/manifest.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const report = loadBuiltinManifests(join(root, 'workflows'))
const tiers = ['fast', 'balanced', 'quality']
const families = {
  'elysium-qwen-image-21-t2i': 'image.text2image',
  'elysium-qwen-image-21-i2i': 'image.image2image',
  'elysium-minimax-h3-ref2v': 'video.reference2video',
  'elysium-minimax-h3-i2v': 'video.image2video',
}
const expected = Object.keys(families).flatMap((family) => tiers.map((tier) => `${family}-${tier}`)).sort()
const expectedSources = [
  'elysium-minimax-h3-i2v.json',
  'elysium-minimax-h3-ref2v.json',
  'elysium-qwen-image-21-i2i.json',
  'elysium-qwen-image-21-t2i.json',
]

let pass = 0
let fail = 0
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

function graphHasSentinel(graph) {
  let found = false
  const walk = (value) => {
    if (typeof value === 'string' && (value === '$model' || value.includes('$assets.'))) found = true
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(graph)
  return found
}

console.log('== Elysium manifest inventory ==')
ok('清单全部通过 schema 校验', report.errors.length === 0, report.errors.join(' | '))
const actual = report.manifests.filter((m) => !m.internal).map((m) => m.id).sort()
const physical = readdirSync(join(root, 'workflows')).filter((name) => name.endsWith('.json')).sort()
ok('活动目录恰好只有 4 份 Elysium 家族清单', JSON.stringify(physical) === JSON.stringify(expectedSources), physical.join(', '))
ok('注册表展开为 12 个 Elysium 档位实现', JSON.stringify(actual) === JSON.stringify(expected), actual.join(', '))

for (const [family, capability] of Object.entries(families)) {
  for (const tier of tiers) {
    const id = `${family}-${tier}`
    const manifest = report.byId[id]
    ok(`${id} 存在`, Boolean(manifest))
    if (!manifest) continue
    ok(`${id} capability 正确`, manifest.capability === capability, manifest.capability)
    ok(`${id} tier/group 正确`, manifest.tier === tier && manifest.group === family)
    ok(`${id} 资产均有默认文件名`, Object.values(manifest.assets || {}).every((a) => Boolean(a.default)))

    const video = capability.startsWith('video.')
    const i2i = capability === 'image.image2image'
    const job = {
      prompt: 'Elysium smoke', seed: 7, steps: tier === 'fast' ? 4 : (tier === 'balanced' ? 8 : 20),
      width: tier === 'fast' ? 832 : 1344, height: tier === 'fast' ? 480 : 768,
      length: 124, fps: 24, prefix: `smoke/${id}`,
      refs: capability.includes('reference') || i2i ? ['reference.png'] : [],
      first_frame: capability === 'video.image2video' ? 'first.png' : null,
      last_frame: capability === 'video.image2video' ? 'last.png' : null,
    }
    let graph = null
    try { graph = buildGraphFromManifest(manifest, job) } catch (error) {
      ok(`${id} 可编译`, false, error.message)
      continue
    }
    ok(`${id} 可编译`, Boolean(graph && Object.keys(graph).length))
    ok(`${id} 编译后无资产哨兵`, !graphHasSentinel(graph))
    if (video) ok(`${id} 未伪装成链式工作流`, !manifest.chain)
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
