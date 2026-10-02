/** Elysium 解析、尺寸和图编译冒烟测试；不访问 ComfyUI。 */
process.env.DSH_SVS_CONFIG = process.env.DSH_SVS_CONFIG || '/nonexistent/svs-smoke-config.json'

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadBuiltinManifests } from '../../lib/manifest.js'
import { _internals } from '../../lib/index.js'

const reg = loadBuiltinManifests(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'workflows'))
const { resolveTieredManifest, computeManifestSize, buildRenderGraph } = _internals
const none = { registry: reg, probe: false, selection: {}, cfg: {} }

let pass = 0
let fail = 0
function eq(name, actual, expected) {
  if (actual === expected) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name} — 期望 ${expected}，实际 ${actual}`) }
}
function ok(name, condition) {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('== resolution ==')
for (const [capability, family] of Object.entries({
  'image.text2image': 'qwen-image-21-t2i-elysium',
  'image.image2image': 'qwen-image-21-i2i-elysium',
  'video.reference2video': 'minimax-h3-ref2v-elysium',
  'video.image2video': 'minimax-h3-i2v-elysium',
})) {
  for (const tier of ['fast', 'balanced', 'quality']) {
    const result = await resolveTieredManifest(capability, tier, null, none)
    eq(`${capability}/${tier}`, result.manifest.id, `${family}-${tier}`)
  }
}

let threw = false
try { await resolveTieredManifest('image.text2image', 'fast', 'minimax-h3-ref2v-elysium-fast', none) } catch { threw = true }
ok('跨能力显式实现被拒绝', threw)

console.log('== size ==')
const image = reg.byId['qwen-image-21-t2i-elysium-balanced']
const videoFast = reg.byId['minimax-h3-ref2v-elysium-fast']
const videoQuality = reg.byId['minimax-h3-ref2v-elysium-quality']
let size = computeManifestSize(image, 'balanced', undefined, undefined, '16:9')
eq('balanced t2i 16:9 width', size.w, 1344)
eq('balanced t2i 16:9 height', size.h, 768)
size = computeManifestSize(videoFast, 'fast', undefined, undefined, '9:16')
eq('fast video 9:16 width', size.w, 480)
eq('fast video 9:16 height', size.h, 832)
size = computeManifestSize(videoQuality, 'quality', undefined, undefined, '16:9')
eq('quality video 16:9 width', size.w, 1344)
eq('quality video 16:9 height', size.h, 768)

console.log('== graph ==')
let rendered = buildRenderGraph(videoFast, { prompt: 'p', mode: 'fast', refs: ['a.png'], prefix: 'x' }, '16:9')
eq('fast graph width', rendered.job.width, 832)
eq('fast graph height', rendered.job.height, 480)
ok('r2v reference injected', Object.values(rendered.graph).some((n) => n.inputs && Object.keys(n.inputs).some((k) => k.startsWith('ref_images.'))))

rendered = buildRenderGraph(reg.byId['minimax-h3-i2v-elysium-balanced'], {
  prompt: 'p', mode: 'balanced', first_frame: 'first.png', last_frame: 'last.png', prefix: 'x',
}, '16:9')
ok('i2v first frame injected', Object.values(rendered.graph).some((n) => n.inputs && n.inputs.first_frame))
ok('i2v last frame injected', Object.values(rendered.graph).some((n) => n.inputs && n.inputs.last_frame))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
