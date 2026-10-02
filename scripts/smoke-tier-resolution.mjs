/** Elysium 三档解析冒烟测试；纯逻辑，不访问 ComfyUI。 */
process.env.DSH_SVS_CONFIG = process.env.DSH_SVS_CONFIG || '/nonexistent/svs-smoke-config.json'

import { _internals } from '../lib/index.js'

const { getRegistry, resolveTieredManifest, describeTierMatrix, effectiveAssetsOf } = _internals
const registry = getRegistry()
const tiers = ['fast', 'balanced', 'quality']
const families = {
  'image.text2image': 'qwen-image-21-t2i-elysium',
  'image.image2image': 'qwen-image-21-i2i-elysium',
  'video.reference2video': 'minimax-h3-ref2v-elysium',
  'video.image2video': 'minimax-h3-i2v-elysium',
}

let pass = 0
let fail = 0
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('== Elysium tier resolution ==')
for (const [capability, family] of Object.entries(families)) {
  for (const tier of tiers) {
    const expected = `${family}-${tier}`
    const result = await resolveTieredManifest(capability, tier, null, { registry, cfg: {}, probe: false })
    ok(`${capability}/${tier} → ${expected}`, result.manifest.id === expected, result.manifest.id)
    ok(`${expected} 资产完整`, Object.values(effectiveAssetsOf(result.manifest)).every(Boolean))
  }

  const fallback = await resolveTieredManifest(capability, null, null, { registry, cfg: {}, probe: false })
  ok(`${capability} 缺省为 fast`, fallback.tier === 'fast')
  ok(`${capability} 缺省仍为 Elysium`, fallback.manifest.id === `${family}-fast`, fallback.manifest.id)
}

console.log('== Explicit configuration ==')
for (const [capability, family] of Object.entries(families)) {
  const cfg = { tiers: { [capability]: { fast: `${family}-fast` } } }
  const result = await resolveTieredManifest(capability, 'fast', null, { registry, cfg, probe: false })
  ok(`${capability} 显式 fast 生效`, result.manifest.id === `${family}-fast`)
  ok(`${capability} 解析来源为 tier-config`, result.resolution === 'tier-config')
}

console.log('== Matrix ==')
const matrix = await describeTierMatrix(registry, { cfg: {}, probe: false })
for (const [capability, family] of Object.entries(families)) {
  const cap = matrix[capability]
  ok(`${capability} 只公开三档`, cap && cap.tiers.join(',') === tiers.join(','))
  ok(`${capability} 只公开 Elysium 家族`, cap && cap.groups.length === 1 && cap.groups[0].id === family)
  ok(`${capability} 默认策略三档均为 Elysium`, cap && Object.values(cap.strategies[0].tiers).every((id) => id.includes('-elysium-')))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
