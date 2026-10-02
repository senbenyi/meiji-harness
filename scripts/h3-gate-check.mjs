// 临时验证脚本：h3-prompt-writing 集成后 hook 门逻辑
import { _internals } from '../lib/index.js'

const { makeH3PromptGateListener, resolveManifest, getRegistry, h3HasSection } = _internals

const REF2V_PROMPT = `subject_definitions:
<Subject 1> is the fox in <Picture 1>, orange fur, white belly.
summary:
[reference generation] The fox jumps.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved.
detailed_description:
The target video is in 3D animated style.
[Shot 1] The fox jumps over a log.
overall_soundscape:
Forest birds.
non_diegetic_music:
N/A
`

const I2V_PROMPT = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description:
[Shot 1] The fox continues from the frame.
overall_soundscape:
Forest birds.
non_diegetic_music:
N/A
`

let pass = 0
let fail = 0
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra ?? '') }
}

const next = async () => ({ kind: 'allow' })
const listener = makeH3PromptGateListener({})

async function run(name, exec) {
  return listener(exec, next)
}

console.log('— h3HasSection —')
assert('subject_definitions detected', h3HasSection(REF2V_PROMPT, 'subject_definitions'))
assert('non_diegetic_music detected', h3HasSection(REF2V_PROMPT, 'non_diegetic_music'))
assert('missing field not detected', !h3HasSection(REF2V_PROMPT, 'summary_typo'))

console.log('— ref2v: H3 workflow + 六段式完整 → allow —')
let r = await run('ref2v structured', {
  name: 'comfy_generate_video', arguments: { prompt: REF2V_PROMPT }, agent: { id: 'a' },
})
assert('allow', r.kind === 'allow')

console.log('— ref2v: 自由格式交给正式编译器 → allow —')
r = await run('ref2v freeform', {
  name: 'comfy_generate_video', arguments: { prompt: '一只狐狸跳过原木，镜头推近。' }, agent: { id: 'b' },
})
assert('allow', r.kind === 'allow', JSON.stringify(r))

console.log('— i2v: H3 workflow + 三段式 + 对齐指令 → allow —')
r = await run('i2v structured', {
  name: 'comfy_generate_video',
  arguments: { prompt: I2V_PROMPT, first_frame_node: 'n1' },
  agent: { id: 'c' },
})
assert('allow', r.kind === 'allow')

console.log('— i2v: 缺对齐指令 → deny —')
r = await run('i2v missing alignment', {
  name: 'comfy_generate_video',
  arguments: { prompt: 'integrated_multimodal_description:\nx\noverall_soundscape:\ny\nnon_diegetic_music:\nN/A', last_frame_node: 'n2' },
  agent: { id: 'd' },
})
assert('deny', r.kind === 'deny' && String(r.reason).includes('对齐指令'))

console.log('— 非 H3 工作流（显式 flux）→ allow —')
r = await run('flux explicit', {
  name: 'comfy_render', arguments: { capability: 'image.text2image', prompt: 'x', tier: 'quality' }, agent: { id: 'e' },
})
assert('allow', r.kind === 'allow')

console.log('— 非视频工具 → allow —')
r = await run('image tool', { name: 'comfy_generate_image', arguments: { prompt: 'x' }, agent: { id: 'f' } })
assert('allow', r.kind === 'allow')

console.log('— fallback 标记不再是旁路；自由文本统一交给编译器 —')
r = await run('fallback marker', {
  name: 'comfy_generate_video', arguments: { prompt: '[PROMPT_FALLBACK]\n一只狐狸跳过原木。' }, agent: { id: 'h' },
})
assert('allow', r.kind === 'allow')

console.log('— 自由文本重复提交始终交给编译器，不做次数状态机 —')
const execG = { name: 'comfy_generate_video', arguments: { prompt: '自由格式' }, agent: { id: 'g' } }
r = await run('g#1', execG); assert('g#1 allow', r.kind === 'allow')
r = await run('g#2', execG); assert('g#2 allow', r.kind === 'allow')
r = await run('g#3', execG); assert('g#3 allow', r.kind === 'allow')

console.log('— 半结构化 prompt 缺字段 → deny —')
r = await run('partial structured', {
  name: 'comfy_generate_video', arguments: { prompt: 'subject_definitions:\\nx\\nsummary:\\ny' }, agent: { id: 'partial' },
})
assert('deny partial', r.kind === 'deny' && String(r.reason).includes('retention_analysis'))

console.log(`\n结果: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
