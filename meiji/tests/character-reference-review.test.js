import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyPackageFixture } from './fixtures/story-package.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { createLibraryEntry } from '../shared/library-rules.js'
import { parseCharacters } from '../server/flow/steps/step-extract-characters.js'
import { savedCharactersInput, checkCharacters } from '../server/flow/steps/step-review-characters.js'
import { characterExtractionContent } from '../shared/character-extraction.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { checkContext } from '../server/runtime/operation-context.js'

const pass = JSON.stringify({ passed: true, issues: [] })
const person = name => ({ ...storyPackageFixture().characters.items[0], name, presence: 'visible' })
const section = (message, title) => JSON.parse(message.user.split(title + '\n')[1].split(/\n\n【/)[0])
const command = (e, mode = 'regenerate') => ({ action: 'story', only: 'characters', mode, projectId: e.id, episodeId: e.episodeId })

test('已有角色完整卡重新审核只提交引用，保留原称谓、类型及库资料', () => {
  const p = episodeFixture(); p.library = { characters: [], scenes: [], props: [] }
  createLibraryEntry(p, 'characters', { ...person('餐馆老板'), aliases: ['旅人'] })
  const group = parseCharacters(JSON.stringify({ items: [{ name: '旅人', presence: 'voice', libraryId: 'R01' }] }), p)
  const before = structuredClone({ p, group })
  for (const saved of [group, { items: group.items }]) {
    const input = savedCharactersInput(p, {}, JSON.parse(JSON.stringify(saved)))
    assert.deepEqual(JSON.parse(input.text), { items: [{ name: '旅人', presence: 'voice', libraryId: 'R01' }] })
    assert.deepEqual(input.check(input.text), [])
    assert.deepEqual(section(input.prompts.review(input.text), '【本次待审内容】'), JSON.parse(input.text))
  }
  assert.deepEqual({ p, group }, before)
})

test('错误ID、名字ID冲突、重复身份与别名歧义拒绝，失败基稿仍可交模型修订', () => {
  const p = episodeFixture(); p.library = { characters: [], scenes: [], props: [] }
  createLibraryEntry(p, 'characters', { ...person('慧珊'), aliases: ['小珊'] })
  const wrong = { items: [{ name: '明忠', presence: 'visible', libraryId: 'R01' }] }
  assert.throws(() => parseCharacters(JSON.stringify(wrong), p), /人物名称与库条目不一致/)
  assert.throws(() => checkCharacters(JSON.stringify(wrong), p), /人物名称与库条目不一致/)
  assert.throws(() => parseCharacters(JSON.stringify({ items: [{ name: '慧珊', libraryId: 'R99' }] }), p), /库条目不存在/)
  assert.throws(() => parseCharacters(JSON.stringify({ items: [{ name: '慧珊' }, { name: '小珊' }] }), p), /重复引用/)
  assert.doesNotThrow(() => buildStoryPrompts(p, 'characters').revision(JSON.stringify(wrong), '改为正确身份'))
  p.library.characters.push({ ...structuredClone(p.library.characters[0]), id: 'R02' })
  assert.throws(() => parseCharacters(JSON.stringify({ items: [{ name: '小珊' }] }), p), /匹配多个/)
})

test('第二集已有慧珊明忠复用；真实审核请求无水合字段，不重新生成库资料', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => {
    createLibraryEntry(root, 'characters', person('明忠'))
    createLibraryEntry(root, 'characters', { ...person('慧珊'), aliases: ['小珊'] })
    return root
  })
  const before = (await e.store.read(e.id)).library, reviews = []
  const raw = { items: [{ ...person('小珊'), libraryId: 'R02', voiceDescription: '模型想重写声线' }, { name: '明忠', presence: 'visible' }] }
  await runOperation(command(e), { home: e.home, request: async message => {
    if (message.skill !== 'review') {
      assert.match(message.user, /"libraryId":\s*"R02"/)
      assert.match(message.user, /小珊/)
      return JSON.stringify(raw)
    }
    const data = section(message, '【本次待审内容】'); reviews.push(data)
    assert.deepEqual(data, { items: [{ name: '小珊', presence: 'visible', libraryId: 'R02' }, { name: '明忠', presence: 'visible', libraryId: 'R01' }] })
    return pass
  } })
  const root = await e.store.read(e.id), view = await e.read()
  assert.equal(reviews.length, 1)
  assert.deepEqual(root.library, before)
  assert.deepEqual(view.plot.characters.extractionLibraryIds, ['R01', 'R02'])
  assert.equal(view.plot.characters.items[0].voiceDescription, before.characters[1].variants[0].fields.voiceDescription)
  assert.equal(view.plot.characters.items[0].sourceName, '小珊')
  assert.equal(view.plot.characters.check.passed, true)
  assert.deepEqual((await latestRun(e.home, e.id, 'characters')).kinds, ['generate', 'review'])
})

test('已有与新增混合：新角色完整审核，发布/恢复/再次审核/修订不改变本轮分类', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => { createLibraryEntry(root, 'characters', { ...person('餐馆老板'), aliases: ['旅人'] }); return root })
  const raw = { items: [{ name: '旅人', presence: 'visible', libraryId: 'R01' }, person('新同行人')] }
  const reviewer = message => {
    const data = section(message, '【本次待审内容】')
    assert.deepEqual(data.items[0], raw.items[0])
    assert.equal(data.items[1].name, '新同行人')
    assert.ok(data.items[1].look)
    assert.ok(data.items[1].identity)
    assert.ok(data.items[1].voiceDescription)
    assert.ok(!data.items[1].libraryId)
    assert.doesNotMatch(message.user.split('【项目库目录】\n')[1].split(/\n\n【/)[0], /新同行人/)
    return pass
  }
  await runOperation(command(e), { home: e.home, request: async m => m.skill === 'review' ? reviewer(m) : JSON.stringify(raw) })
  const view = JSON.parse(JSON.stringify(await e.read()))
  assert.deepEqual(view.plot.characters.extractionLibraryIds, ['R01'])
  assert.equal(view.library.characters.length, 2)
  assert.equal(view.plot.characters.items[1].ref.libraryId, 'R02')
  const input = savedCharactersInput(view, {}, view.plot.characters)
  assert.deepEqual(input.check(input.text), [])
  reviewer(input.prompts.review(input.text))
  const invalidNew = JSON.parse(input.text); invalidNew.items[1].look = ''
  assert.throws(() => input.check(JSON.stringify(invalidNew)), /画面提示词/)
  checkContext.run({ generationMode: 'modify', originalProject: view }, () => {
    const base = section(buildStoryPrompts(view, 'characters').generation, '【修改基稿】')
    assert.deepEqual(base.items[0], raw.items[0])
    assert.equal(base.items[1].libraryId, '')
    assert.ok(base.items[1].look)
  })
  let count = 0
  await runOperation(command(e, 'review'), { home: e.home, request: async m => { count++; assert.equal(m.skill, 'review'); return reviewer(m) } })
  assert.equal(count, 1)
})

test('程序投影不抹去新增资料或未解析失败稿，也不写回卡片', () => {
  const p = episodeFixture(); p.library = { characters: [], scenes: [], props: [] }
  const raw = { items: [person('新人物')] }, before = structuredClone(raw)
  assert.deepEqual(characterExtractionContent(p, raw), raw)
  assert.equal(characterExtractionContent(p, '不合法JSON'), '不合法JSON')
  assert.deepEqual(raw, before)
})

test('自动修订和复审沿用引用基稿，新增问题仍进入模型审核', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => { createLibraryEntry(root, 'characters', person('旅人')); return root })
  const raw = { items: [{ name: '旅人', presence: 'visible', libraryId: 'R01' }, person('新人物')] }
  let reviews = 0, revisions = 0
  await runOperation(command(e), { home: e.home, request: async message => {
    if (message.skill === 'review') {
      const data = section(message, '【本次待审内容】')
      assert.deepEqual(data.items[0], raw.items[0])
      assert.ok(data.items[1].look)
      if (++reviews === 1) return JSON.stringify({ passed: false, issues: [{ location: '新人物 identity', reason: '身份描述不清楚', requirement: '明确新人物身份' }] })
      assert.equal(data.items[1].identity, '庭院中独立身体的新同行人')
      assert.deepEqual(section(message, '【修订基稿（用于对照范围）】').items[0], raw.items[0])
      return pass
    }
    if (message.user.includes('【修改基稿】')) {
      revisions++
      assert.deepEqual(section(message, '【修改基稿】').items[0], raw.items[0])
      return JSON.stringify({ items: [raw.items[0], { ...raw.items[1], identity: '庭院中独立身体的新同行人' }] })
    }
    return JSON.stringify(raw)
  } })
  assert.equal(reviews, 2); assert.equal(revisions, 1)
  assert.deepEqual((await latestRun(e.home, e.id, 'characters')).kinds, ['generate', 'review', 'revise', 're_review'])
  assert.deepEqual((await e.read()).plot.characters.extractionLibraryIds, ['R01'])
})

test('无效引用的程序修复能够收到失败稿，修正后复用正确角色', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => { createLibraryEntry(root, 'characters', person('旅人')); return root })
  let generated = 0
  await runOperation(command(e), { home: e.home, request: async message => {
    if (message.skill === 'review') return pass
    generated++
    if (generated === 1) return JSON.stringify({ items: [{ name: '旅人', presence: 'visible', libraryId: 'R99' }] })
    assert.equal(section(message, '【最新失败稿（唯一修改基准）】').items[0].libraryId, 'R99')
    return JSON.stringify({ items: [{ name: '旅人', presence: 'visible', libraryId: 'R01' }] })
  } })
  assert.equal(generated, 2)
  assert.equal((await e.read()).plot.characters.items[0].ref.libraryId, 'R01')
  assert.equal((await e.store.read(e.id)).library.characters.length, 1)
})
