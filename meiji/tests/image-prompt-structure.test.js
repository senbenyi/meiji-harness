import { promptData } from './fixtures/prompt-data.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacterImageModel } from '../server/prompts/models/character-image-model.js'
import { createSceneImageModel } from '../server/prompts/models/scene-image-model.js'
import { imageSegments } from '../server/prompts/interfaces/prompt-interfaces.js'
import { render } from '../server/prompts/skill-prompts.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'

const base64 = 'data:image/png;base64,AA=='
const configurations = [
  { label: '人物', role: '人物角色设计师', create: createCharacterImageModel, purpose: 'character-reference',
    facts: { character: { name: '新人物', gender: '男', age: '30', features: '短发方脸' } } },
  { label: '场景', role: '影视场景设计师', create: createSceneImageModel, purpose: 'scene-reference',
    facts: { scene: { name: '新场景', landmark: '案、窗、房门', light: '清晨窗外透光', space: '案在窗下', look: '清晨昏暗的长方形卧房' }, additionalInstructions: 'SUPPLEMENT_RULE' } },
]

for (const { label, role, create, purpose, facts } of configurations) {
  test(`${label}图片三种模式统一分区，身份只一句，规则不混入任务`, () => {
    for (const mode of ['generate', 'reference', 'modify']) {
      const images = mode === 'generate' ? [] : mode === 'reference'
        ? [{ purpose, base64 }, { purpose, base64 }]
        : [{ purpose: 'edit-base', base64 }, { purpose, base64 }]
      const model = create({ ...facts, mode, images, generationRules: 'BASE_RULE', canvas: { width: 1344, height: 768 },
        modification: mode === 'modify' ? { instruction: 'CURRENT_OPINION' } : null })
      const prompt = model.toPrompt()
      assert.equal(prompt.split('【角色与职责】\n')[1].split('\n\n')[0], `你是一名${role}。`)
      assert.match(prompt, /【本次任务】\n依据本次.*资料.*基础规则和补充规则。/)
      const task = prompt.split('【本次任务】\n')[1].split('\n\n')[0]
      assert.doesNotMatch(task, /地标|光位|服装|全景|保留未涉及|只输出|BASE_RULE|CURRENT_OPINION/)
      assert.match(prompt, new RegExp(`【核心输入：${label}资料】\\n`))
      assert.deepEqual(promptData(prompt, '【本次参数】'), { width: 1344, height: 768, orientation: '横幅' })
      assert.match(prompt, /【基础规则】\nBASE_RULE/)
      assert.match(prompt, /【本次输出协议】\n只输出一张图片，不输出解释或审核文字。$/)
      assert.doesNotMatch(prompt, /【资料边界】|【任务】|【生成规则】|【画幅】|【本剧补充】|data:image|base64|未提供的大纲示例/)
      const headers = prompt.match(/^【[^\n]+】$/gm)
      assert.deepEqual(headers.slice(0, 4), ['【角色与职责】', '【本次任务】', `【核心输入：${label}资料】`, '【本次参数】'])
      assert.equal(headers.at(-1), '【本次输出协议】')
      if (label === '场景') assert.match(prompt, /【补充规则】\nSUPPLEMENT_RULE/)
      if (mode === 'generate') assert.doesNotMatch(prompt, /【参考图片】|【本次修改意见】|【本次修订范围】/)
      else {
        assert.equal(model.images[0].base64, base64)
        assert.deepEqual(promptData(prompt, '【参考图片】').images, images.map(({ purpose }, index) => ({ index: index + 1, purpose })))
        if (mode === 'reference') {
          assert.match(prompt, /参考图片仅提供/)
          assert.match(prompt, /以本次.*资料为准/)
          assert.doesNotMatch(prompt, /【本次修改意见】|【本次修订范围】/)
        } else {
          assert.equal(promptData(prompt, '【参考图片】').images[0].purpose, 'edit-base')
          assert.match(prompt, /【本次修改意见】\nCURRENT_OPINION/)
          assert.match(prompt, /【本次修订范围】/)
          assert.match(prompt, /最新.*资料/)
          assert.match(prompt, /保留原图中未被意见/)
          const replace = create({ ...JSON.parse(JSON.stringify(model)), modification: { instruction: 'CURRENT_OPINION', preserveUnspecified: false } })
          assert.doesNotMatch(replace.toPrompt(), /保留原图中未被意见/)
        }
      }
      assert.equal(create(JSON.parse(JSON.stringify(model))).toPrompt(), prompt)
    }
  })
}

test('人物无卡模板也通过 Model 编排角色、资料、画幅和输出协议', () => {
  const project = { style: '不注入的风格', outputLanguage: 'en' }, set = builtinSkillSet()
  const preview = previewPrompts({ stage: 'character-image', root: project, skillSet: set }).image
  const text = render(preview.user)
  assert.equal(text.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名人物角色设计师。')
  assert.match(promptData(text, '【核心输入：人物资料】').description, /^（人物资料将在生成时/)
  assert.deepEqual(promptData(text, '【本次参数】'), { width: 768, height: 1344, orientation: '竖幅' })
  assert.match(text, /【本次输出协议】/)
  assert.doesNotMatch(text, /不注入的风格|【语言】/)
  const actual = render(imageSegments({ stage: 'character-image', project, skillSet: set, request: '明确提供的模板资料' }))
  assert.deepEqual(promptData(actual, '【核心输入：人物资料】'), { description: '明确提供的模板资料' })
})

test('场景基本规则不假定存在已给剧情或机位，空图用真实场景尺度', () => {
  const rule = builtinSkillSet().skills['scene-image'].constraints
  assert.doesNotMatch(rule, /已给剧情|剧情中的行动时间|本次指定机位|没有指定人物朝向/)
  assert.match(rule, /资料明确要求.*活动空间时/)
  assert.match(rule, /场景资料未指定视向时.*中性建立视图/)
  assert.match(rule, /不要画人物、人群、剪影、手或脸/)
  assert.match(rule, /不同机位中的光源保持同一世界方向/)
})
