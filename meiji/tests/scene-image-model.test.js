import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageModel, sceneImageModelToPrompt } from '../server/prompts/models/scene-image-model.js'
import { sceneImageModel, sceneImageModificationModel, sceneImagePrompt } from '../server/prompts/interfaces/scene-image.js'
import { previewPrompts } from '../server/prompts/preview.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { render } from '../server/prompts/skill-prompts.js'

const input = {
  scene: { name: '庭院', landmark: '南门北墙', light: '西侧夕阳', space: '南门通向北墙，中央留出通路', look: '完整门墙与远山', hidden: '无关数据' },
  generationRules: '无人空景，地标和光位保持一致。',
  canvas: { width: 1600, height: 904 },
  style: '不注入的水彩', language: 'en',
}
const base64 = 'data:image/png;base64,b3JpZ2luYWw='

test('场景 model 五项资料独立复制，可 JSON 往返，内部生成具名分节提示词', () => {
  const model = createSceneImageModel(input)
  assert.deepEqual(Object.keys(model.scene), ['name', 'landmark', 'light', 'space', 'look'])
  assert.equal(model.role, '影视场景设计师')
  assert.equal(model.toPrompt(), sceneImageModelToPrompt(JSON.parse(JSON.stringify(model))))
  assert.match(model.toPrompt(), /【场景资料】\n名称：庭院\n地标：南门北墙\n光位：西侧夕阳/)
  assert.match(model.toPrompt(), /1600 × 904 像素，横幅/)
  assert.doesNotMatch(model.toPrompt(), /水彩|【语言】|English|视觉风格|无关数据/)
  model.scene.name = '新院'
  model.canvas.width = 800
  assert.equal(input.scene.name, '庭院')
  assert.equal(input.canvas.width, 1600)
})

test('参考图和原图保持 Base64 顺序但不把数据拼入正文；意见单独保存', () => {
  const reference = createSceneImageModel({ ...input, mode: 'reference', images: [{ purpose: 'scene-reference', base64 }] })
  assert.match(reference.toPrompt(), /输入图片1：场景空间与环境参考/)
  assert.doesNotMatch(reference.toPrompt(), /data:image|b3JpZ2luYWw=/)
  const modify = createSceneImageModel({ ...input, mode: 'modify', images: [{ purpose: 'edit-base', base64 }, { purpose: 'scene-reference', base64 }], modification: { instruction: ' 镜头后退，扩大安全边距 ' } })
  assert.match(modify.toPrompt(), /【本次修改意见】\n镜头后退，扩大安全边距/)
  assert.match(modify.toPrompt(), /始终按最新场景资料成图/)
  assert.match(modify.toPrompt(), /意见仅用于场景资料之外/)
  assert.equal(modify.images[0].base64, base64)
  assert.doesNotMatch(modify.toPrompt(), /data:image/)
})

test('模式、画幅和图片用途需有效，空规则不追加默认正文', () => {
  for (const patch of [
    { scene: null }, { generationRules: null }, { canvas: { width: 0, height: 10 } },
    { mode: 'unknown' }, { images: [{ purpose: 'scene-reference', base64 }] },
    { mode: 'reference' }, { mode: 'modify', images: [{ purpose: 'scene-reference', base64 }], modification: { instruction: '后退' } },
    { mode: 'modify', images: [{ purpose: 'edit-base', base64 }], modification: { instruction: '' } },
    { mode: 'reference', images: [{ purpose: 'scene-reference', base64: '/url.png' }] },
    { additionalInstructions: null },
  ]) assert.throws(() => createSceneImageModel({ ...input, ...patch }), { status: 400 })
  const prompt = createSceneImageModel({ ...input, generationRules: '' }).toPrompt()
  assert.doesNotMatch(prompt, /【生成规则】|无人空景，地标和光位保持一致。/)
})

test('场景接口保留基础快照，忽略旧本剧覆盖，实际卡与预览同源', () => {
  const project = { aspectRatio: '1344x768', style: '水彩', outputLanguage: 'en', plot: { scenes: { items: [{ ...input.scene, type: 'scene' }] } } }
  const set = builtinSkillSet({ additions: { 'scene-image': { generate: '本剧补充：保留真实尺度' } } })
  set.skills['scene-image'].constraints = '基础覆盖：无人空景'
  const model = sceneImageModel(input.scene, project, {}, set)
  assert.equal(model.generationRules, '基础覆盖：无人空景')
  assert.doesNotMatch(model.toPrompt(), /本剧补充：保留真实尺度/)
  const previews = previewPrompts({ stage: 'scene-image', root: {}, view: project, skillSet: set })
  assert.equal(render(previews.image.user), sceneImagePrompt(input.scene, project, set))
  const modify = sceneImageModificationModel(input.scene, project, { images: [{ purpose: 'edit-base', base64 }], instruction: '（此处为人工修改意见）' }, set)
  assert.equal(render(previews.modify.user), modify.toPrompt())
  assert.equal(previews.modify.chars, modify.toPrompt().length)
  assert.doesNotMatch(model.toPrompt(), /水彩|本次生成语言/)
})

test('三种图片任务明确资料依据，图片输出要求由 Model 提供而非依赖 skill', () => {
  const base = { scene: { name: '庭院' }, canvas: { width: 100, height: 100 }, generationRules: '' }
  for (const mode of ['generate', 'reference', 'modify']) {
    const model = createSceneImageModel({ ...base, mode,
      images: mode === 'generate' ? [] : [{ purpose: mode === 'modify' ? 'edit-base' : 'scene-reference', base64: 'data:image/png;base64,AA==' }],
      modification: mode === 'modify' ? { instruction: '减少雾气' } : null })
    const prompt = model.toPrompt()
    assert.match(prompt, /根据下方(?:最新)?场景资料/)
    assert.match(prompt, /【输出要求】\n只输出一张图片/)
    assert.doesNotMatch(prompt, /base64/)
  }
})
