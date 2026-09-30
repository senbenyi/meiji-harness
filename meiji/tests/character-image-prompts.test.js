import test from 'node:test'
import assert from 'node:assert/strict'
import { adultCharacter, characterImagePrompt, characterStillPrompt } from '../server/prompts/interfaces/character-image.js'
import { previewPrompts } from '../server/prompts/preview.js'
import { render } from '../server/prompts/skill-prompts.js'
import { imageSkillPrompt } from '../server/generate/image.js'
import { builtinSkillSet, loadSkillSet, skillStore, skillUse, skillsRoot, additionsPatch } from '../server/data/skill-store.js'
import { executionContext } from '../server/data/task-store.js'
import { checkContext } from '../server/data/operation-context.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from './fixtures/model.js'

const character = { id: 'C01', type: 'role', name: '甲', nationality: '中国', role: '旅人', gender: '男', era: '现代', age: '23', height: '一米八', build: '健壮', features: '短发方脸', costume: '旧外套', prop: '木剑', look: '面向：背面' }
const view = item => ({ style: '水彩', outputLanguage: 'en', plot: { characters: { items: [item] } }, skills: { additions: { 'character-image': { generate: '本剧人物图补充' } } } })
const preview = (project, skillSet) => previewPrompts({ stage: 'character-image', root: {}, view: project, skillSet }).image

test('人物模块自行选择外观字段，排除剧情服装、道具与旧面向指令', () => {
  assert.equal(characterStillPrompt(character), '中国，甲，旅人，男，现代，23，一米八，健壮，短发方脸')
  assert.doesNotMatch(characterStillPrompt(character), /旧外套|木剑|背面|面向：/)
})

test('人物年龄判断迁移后保留数字、中文岁数与未知年龄分支', () => {
  for (const age of ['18', '十八岁', '二十三岁', '43 years']) assert.equal(adultCharacter({ age }), true, age)
  for (const age of ['17', '十七岁', '七岁', '儿童', 'teen', '青年', '']) assert.equal(adultCharacter({ age }), false, age)
  assert.equal(adultCharacter({ look: '年龄：二十岁 服装：外套' }), true)
})

test('人物固定约束只读且不受旧基础覆盖和本剧补充影响', async t => {
  const home = await tempHome(t)
  const store = skillStore(home)
  await mkdir(skillsRoot(home), { recursive: true })
  await writeFile(join(skillsRoot(home), 'character-image.json'), JSON.stringify({ fields: { generate: { text: '旧页面规则', builtinHash: 'old' } }, previous: { generate: { text: '旧上一版' } } }))
  await assert.rejects(store.save('character-image', { generate: '新规则' }), /不可编辑/)
  await assert.rejects(store.save('character-image', { constraints: '覆盖约束' }), /不可编辑/)
  await assert.rejects(store.reset('character-image', { field: 'generate' }), /不可编辑/)
  assert.throws(() => additionsPatch({}, 'character-image', { generate: '补充' }), /不可补充/)
  const project = view(character)
  const set = await loadSkillSet(home, project.skills)
  const actual = executionContext.run({ skillSet: set, skills: new Map() }, () => characterImagePrompt(character, project))
  const shown = preview(project, set)
  assert.equal(render(shown.user), actual)
  assert.equal(shown.chars, actual.length)
  assert.doesNotMatch(actual, /旧页面规则|旧上一版|本剧人物图补充/)
  assert.deepEqual((await store.get('character-image')).previous, [])
  assert.deepEqual(skillUse(set, 'character-image').layers, ['builtin'])
  assert.doesNotMatch(actual, /本次生成语言|English|简体中文/)
  assert.doesNotMatch(actual, /项目视觉风格|水彩/)
  assert.ok(actual.endsWith(characterStillPrompt(character)))
})

test('空约束不注入默认值；固定内容纳入技能快照与哈希', () => {
  const project = view(character)
  const original = builtinSkillSet(project.skills)
  const set = structuredClone(original)
  set.skills['character-image'].constraints = ''
  set.skills['character-image'].parts.generate = '不应回退的生成指导'
  const actual = characterImagePrompt(character, project, set)
  assert.doesNotMatch(actual, /正面全身照|灰白|完整服装|比基尼|不应回退|本剧人物图补充/)
  const child = { ...character, age: '12' }
  assert.doesNotMatch(characterImagePrompt(child, project, set), /正面全身照|完整服装/)
  assert.equal(render(preview(project, set).user), actual)
  assert.notEqual(skillUse(set, 'character-image').hash, skillUse(original, 'character-image').hash)
  const frozen = structuredClone(original)
  const changed = structuredClone(original)
  changed.skills['character-image'].constraints = '只用新约束'
  assert.equal(characterImagePrompt(character, project, frozen), characterImagePrompt(character, project, original))
  assert.ok(characterImagePrompt(character, project, changed).startsWith('只用新约束'))
  assert.notEqual(skillUse(changed, 'character-image').hash, skillUse(original, 'character-image').hash)
})

test('未成年与年龄不明人物在实际生成和预览中使用相同适龄约束', () => {
  for (const age of ['十六岁', '青年', '']) {
    const card = { ...character, age, look: '' }
    const project = view(card)
    const set = builtinSkillSet(project.skills)
    set.skills['character-image'].parts.generate = '不应使用的可编辑规则'
    const actual = characterImagePrompt(card, project, set)
    assert.equal(render(preview(project, set).user), actual)
    assert.match(actual, /按年龄穿着完整服装/)
    assert.doesNotMatch(actual, /不应使用的可编辑规则|本剧人物图补充/)
    assert.ok(actual.endsWith(characterStillPrompt(card)))
  }
})

test('人物模块统一编入原图提示词和人工意见，预览与生成一致', () => {
  const project = view(character)
  const set = builtinSkillSet(project.skills)
  checkContext.run({ review: '头转向左侧', originalCandidate: { request: { prompt: '原图提示词' } } }, () => {
    const actual = characterImagePrompt(character, project, set)
    assert.equal(render(preview(project, set).user), actual)
    assert.match(actual, /原生成提示词（修改基稿）：\n原图提示词/)
    assert.match(actual, /本次意见（在原内容基础上修改，保留未涉及部分）：\n头转向左侧/)
  })
})

test('人物预览选第一张人物卡；没有人物时明确标记为模板预览', () => {
  const project = view(character)
  project.plot.characters.items.unshift({ id: 'E01', type: 'scene', name: '场景卡' })
  project.plot.characters.items.push({ ...character, id: 'C02', name: '乙' })
  const set = builtinSkillSet(project.skills)
  assert.equal(render(preview(project, set).user), characterImagePrompt(character, project, set))
  const empty = { style: '水彩', skills: {} }
  const template = render(preview(empty, builtinSkillSet()).user)
  assert.match(template, /当前仅预览技能模板/)
  assert.match(template, /具体年龄约束以人物卡为准/)
})

test('其他图片接口预览保留原来的上下文占位和结构', () => {
  const project = view(character)
  for (const stage of ['scene-image', 'part-image', 'pencil']) {
    const result = previewPrompts({ stage, root: project, skillSet: builtinSkillSet(project.skills) }).image
    assert.equal(render(result.user), imageSkillPrompt(stage, '（本次画面要求由程序按卡片或文本分镜生成）', project))
  }
})
