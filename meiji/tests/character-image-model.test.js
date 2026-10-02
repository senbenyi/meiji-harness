import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCharacterImageModel, characterImageModelToPrompt } from '../server/prompts/models/character-image-model.js'

const input = {
  character: { name: '甲', role: '旅人', gender: '男', era: '现代', age: '23', height: '180cm', build: '健壮', features: '短发方脸', costume: '旧外套', prop: '木剑', look: '面向：背面' },
  style: '不应注入的水彩风格',
  language: 'en',
  generationRules: '正面全身照。\n## 成年人物\n成年规则\n## 未成年或年龄不明\n适龄规则',
  canvas: { width: 1000, height: 1500 },
}

test('人物图 model 只包含指定输入属性，可 JSON 往返且不共享输入对象', () => {
  const model = createCharacterImageModel(input)
  assert.deepEqual(Object.keys(model), ['character', 'generationRules', 'canvas', 'mode', 'role', 'images', 'modification'])
  assert.deepEqual(Object.keys(model.character), ['nationality', 'name', 'role', 'gender', 'era', 'age', 'height', 'build', 'features'])
  assert.equal(Object.hasOwn(model, 'style'), false)
  assert.equal(Object.hasOwn(model, 'language'), false)
  assert.doesNotMatch(model.toPrompt(), /【语言】|本次生成语言|English|简体中文/)
  assert.doesNotMatch(model.toPrompt(), /视觉风格|不应注入的水彩风格/)
  assert.equal(model.character.name, '甲')
  assert.equal(model.character.nationality, '中国')
  assert.equal(model.generationRules, input.generationRules)
  assert.deepEqual(JSON.parse(JSON.stringify(model)), JSON.parse(JSON.stringify(createCharacterImageModel(input))))
  assert.equal(characterImageModelToPrompt(JSON.parse(JSON.stringify(model))), characterImageModelToPrompt(model))
  model.character.name = '乙'
  model.canvas.width = 2000
  assert.equal(input.character.name, '甲')
  assert.equal(input.canvas.width, 1000)
})

test('基础转换使用具名人物资料和分节自然语言，不混入剧情服装道具或面向', () => {
  const prompt = characterImageModelToPrompt(createCharacterImageModel(input))
  assert.match(prompt, /【核心输入：人物资料】\n国籍：中国\n姓名：甲\n身份：旅人\n性别：男/)
  assert.match(prompt, /年龄：23\n身高：180cm\n体型：健壮\n面相：短发方脸/)
  assert.doesNotMatch(prompt, /旧外套|木剑|背面|服装：|道具：|面向：/)
  assert.ok(prompt.indexOf('【本次任务】') < prompt.indexOf('【核心输入：人物资料】'))
  assert.ok(prompt.indexOf('【核心输入：人物资料】') < prompt.indexOf('【基础规则】'))
  assert.ok(prompt.indexOf('【核心输入：人物资料】') < prompt.indexOf('【本次参数】'))
  assert.ok(prompt.indexOf('【本次参数】') < prompt.indexOf('【基础规则】'))
})

test('自定义画幅按像素输出，无固定尺寸枚举，转换时也校验输入', () => {
  for (const [width, height, orientation] of [[1000, 1500, '竖幅'], [1600, 900, '横幅'], [800, 800, '正方形']]) {
    const model = createCharacterImageModel({ ...input, canvas: { width, height } })
    assert.match(characterImageModelToPrompt(model), new RegExp(`${width} × ${height} 像素，${orientation}`))
  }
  for (const canvas of [undefined, null, { width: 0, height: 10 }, { width: -1, height: 10 }, { width: 1.5, height: 10 }, { width: '1000', height: 10 }, { width: Infinity, height: 10 }, { width: Number.MAX_SAFE_INTEGER + 1, height: 10 }]) {
    assert.throws(() => createCharacterImageModel({ ...input, canvas }), /正整数像素/)
    assert.throws(() => characterImageModelToPrompt({ ...input, canvas }), /正整数像素/)
  }
})

test('规则正文由调用方提供并完整保留；空正文不追加默认规则', () => {
  const rules = readFileSync(new URL('../skills/task/generate-character-image-skill.md', import.meta.url), 'utf8')
  const model = createCharacterImageModel({ ...input, generationRules: rules })
  assert.equal(model.generationRules, rules)
  assert.ok(characterImageModelToPrompt(model).includes(rules.trim()))
  for (const generationRules of ['', ' \n ']) {
    const prompt = characterImageModelToPrompt(createCharacterImageModel({ ...input, generationRules }))
    assert.doesNotMatch(prompt, /【基础规则】|正面全身照|成年规则|适龄规则/)
  }
})

test('缺少人物资料或规则正文时明确报错，沿用 look 资料解析', () => {
  assert.throws(() => createCharacterImageModel(), /人物资料/)
  for (const character of [null, '甲', []]) assert.throws(() => createCharacterImageModel({ ...input, character }), /人物资料/)
  assert.throws(() => createCharacterImageModel({ character: input.character, canvas: input.canvas }), /规则必须是字符串/)
  const prompt = characterImageModelToPrompt(createCharacterImageModel({ ...input, character: { look: '姓名：乙 性别：女 年龄：二十岁 面相：圆脸' } }))
  assert.match(prompt, /姓名：乙\n性别：女\n年龄：二十岁\n面相：圆脸/)
})

test('修改 model 固定角色职责，Base64 原图与人工意见分开保存，图片数据不进入 prompt', () => {
  const base64 = 'data:image/png;base64,b3JpZ2luYWw='
  const model = createCharacterImageModel({ ...input, mode: 'modify', images: [{ purpose: 'edit-base', base64 }], modification: { instruction: ' 将头发改为黑色短发 ' } })
  assert.equal(model.role, '人物角色设计师')
  assert.equal(model.modification.instruction, '将头发改为黑色短发')
  assert.equal(model.images[0].base64, base64)
  assert.equal(model.toPrompt(), characterImageModelToPrompt(JSON.parse(JSON.stringify(model))))
  assert.match(model.toPrompt(), /【角色与职责】\n你是一名人物角色设计师/)
  assert.match(model.toPrompt(), /【参考图片】\n输入图片1：本次编辑原图/)
  assert.match(model.toPrompt(), /【本次修改意见】\n将头发改为黑色短发/)
  assert.match(model.toPrompt(), /保留原图中未被意见/)
  assert.doesNotMatch(model.toPrompt(), /data:image|b3JpZ2luYWw=/)
  assert.equal(createCharacterImageModel({ ...JSON.parse(JSON.stringify(model)), role: '导演' }).role, '人物角色设计师')
})

test('参考与修改模式校验图片用途及意见，不允许缺图后降级生成', () => {
  const image = { purpose: 'edit-base', base64: 'data:image/png;base64,AA==' }
  assert.throws(() => createCharacterImageModel({ ...input, mode: 'modify' }), /原图/)
  assert.throws(() => createCharacterImageModel({ ...input, mode: 'modify', images: [image] }), /输入意见/)
  assert.throws(() => createCharacterImageModel({ ...input, mode: 'reference' }), /参考图/)
  assert.throws(() => createCharacterImageModel({ ...input, mode: 'modify', images: [{ ...image, base64: '/original.png' }] }), /Base64/)
  const reference = createCharacterImageModel({ ...input, mode: 'reference', images: [{ ...image, purpose: 'character-reference' }] })
  assert.match(reference.toPrompt(), /人物外观参考/)
  assert.doesNotMatch(reference.toPrompt(), /【本次修改意见】/)
})
