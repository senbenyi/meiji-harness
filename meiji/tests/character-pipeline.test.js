import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { savePicture, readPicture, readImageDraft, saveImageDraft, pictureTargetSnapshot } from '../server/data/image-storage.js'
import { applyLibraryImageDraft } from '../server/data/library-image-storage.js'
import { createLibraryEntry, applyLibraryCard } from '../shared/library-rules.js'
import { cardModel, setContent } from '../server/models/data/drama-model.js'
import { characterWardrobePrompts } from '../server/prompts/character-wardrobe-prompts.js'
import { characterImagePrompt } from '../server/prompts/interfaces/character-image-interface.js'
import { submitAssetImage } from '../server/flow/steps/shared/image-files.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { parseSecondsResponse, secondsCharacterRoster } from '../shared/seconds-content.js'
import { filmSubmit } from '../server/flow/steps/shared/video-submit.js'
import { storyboardReady } from '../server/flow/steps/shared/film-freshness.js'
import { planRun } from '../shared/run-planner.js'

const costumes = [{ id: 'daily', name: '日常', description: '蓝色短衣' }, { id: 'night', name: '夜行', description: '黑色长袍' }]
function dressed() {
  const p = episodeFixture(), shot = p.shots.items[0], card = p.plot.characters.items[0]
  card.costumes = structuredClone(costumes)
  card.defaultCostumeId = 'night'
  card.image.content = { localPath: '/base.png', costumes: Object.fromEntries(costumes.map(row => [row.id, { localPath: `/${row.id}.png`, description: row.description }])) }
  shot.seconds.content.version = 2
  shot.seconds.content.participants = [{ name: card.name, presence: 'visible', outfit: '黑色长袍，衣襟扣合', costumeId: 'night' }]
  return { p, shot, card }
}
test('每秒指令必须选择本角色服装；视频只引用选中穿搭图，更新即失效', () => {
  const { p, shot, card } = dressed()
  assert.deepEqual(secondsCharacterRoster(p)[0].costumes, costumes)
  const parse = () => parseSecondsResponse(JSON.stringify({ shots: [shot.seconds.content] }), [shot], p)
  assert.doesNotThrow(parse)
  const before = structuredClone(p), board = compileVideoPrompt(p, shot)
  assert.deepEqual(board.referenceSnapshot.map(row => row.url), ['/night.png'])
  assert.equal(board.referenceSnapshot[0].costumeId, 'night')
  assert.doesNotMatch(board.prompt.text, /base\.png|daily\.png/)
  assert.deepEqual(p, before)
  setContent(shot.storyboard, board, { passed: true, failures: [] })
  assert.equal(storyboardReady(p, shot.id), true)
  shot.seconds.content.participants[0].costumeId = 'daily'
  assert.equal(storyboardReady(p, shot.id), false)
  assert.throws(() => filmSubmit(p, { id: shot.id, ...board }, {}), /已变化/)
  for (const id of [undefined, '', 'other-person-outfit']) {
    shot.seconds.content.participants[0].costumeId = id
    assert.throws(parse, /costumeId|服装 ID/)
    assert.throws(() => compileVideoPrompt(p, shot), /服装 ID/)
  }
  shot.seconds.content.participants[0].costumeId = 'night'
  card.costumes[1].description = '红色长袍'
  assert.throws(() => compileVideoPrompt(p, shot), /穿搭图缺失或已过期/)
})

test('补全服装时复用基准图与已完成人物穿搭，仅缺失服装调用模型', async t => {
  const e = await setupModel(t), p = await e.read(), card = p.plot.characters.items[0]
  card.costumes = structuredClone(costumes)
  const base = await savePicture(e.home, Buffer.from('same-face'), 'image/png', 'characters', 'base')
  const daily = await savePicture(e.home, Buffer.from('daily-worn'), 'image/png', 'characters', 'daily')
  card.image.content = { ...base, costumes: { daily: { ...daily, description: costumes[0].description } } }
  const calls = []
  const result = await submitAssetImage({ assets: p.plot.characters, itemId: card.id, home: e.home, projectId: e.id, episodeId: e.episodeId,
    directory: join(e.home, 'images'), backend: { baseUrl: 'https://gateway.test/v1', apiKey: 'test', model: 'elysium-image' }, aspectRatio: '768x1344', reuseCurrent: true,
    prompt: characterImagePrompt(card, p), costumePrompts: characterWardrobePrompts(card, p),
    fetchImpl: async (url, options) => {
      if (options.method === 'GET') return new Response(Buffer.from('night-worn'))
      calls.push(Object.fromEntries(options.body))
      return Response.json({ data: [{ url: 'https://gateway.test/v1/media/image_1' }] })
    } })
  assert.equal(calls.length, 1)
  assert.match(calls[0].prompt, /黑色长袍/)
  assert.deepEqual(Buffer.from(await calls[0]['image[]'].arrayBuffer()), Buffer.from('same-face'))
  const draft = result.items[0].pendingImage
  assert.equal((await readImageDraft(e.home, draft.draftId)).bytes.toString(), 'same-face')
  assert.equal((await readImageDraft(e.home, draft.costumes.daily.draftId)).bytes.toString(), 'daily-worn')
  assert.equal((await readImageDraft(e.home, draft.costumes.night.draftId)).bytes.toString(), 'night-worn')
})

test('项目提取只为本轮可见角色展开图片，不处理未提取角色或声音角色', () => {
  const p = { library: { characters: [], scenes: [], props: [] }, projectCharacters: { items: [{ name: '甲', presence: 'visible' }, { name: '乙', presence: 'voice' }] } }
  for (const name of ['甲', '乙', '未提取']) createLibraryEntry(p, 'characters', { name })
  const plan = planRun(p, { to: 'images', scope: { kinds: ['characters'] } }, { projectCharacters: true, autoSaveImages: true })
  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].input.goal.scope.library.id, p.library.characters[0].id)
  const reviewed = planRun({ ...p, mode: 'script', script: '剧本' }, { to: 'project-characters', mode: 'review' })
  assert.ok(reviewed.steps.every(step => step.kind === 'review'))
})

for (const failure of ['过期', '取消', '保存失败']) test(`库自动入库${failure}保留旧图，不遗留新素材`, async t => {
  const e = await setupModel(t), old = await savePicture(e.home, Buffer.from('old'), 'image/png', 'characters', 'old')
  await e.store.save(e.id, p => { createLibraryEntry(p, 'characters', { name: '新人物', image: { content: old } }); return p })
  const root = await e.store.read(e.id), entry = root.library.characters.at(-1), variant = entry.variants[0]
  const card = applyLibraryCard(root, 'characters', cardModel({ id: variant.id, type: 'role' }), { entry, variant })
  const draft = { ...await saveImageDraft(e.home, Buffer.from('new'), 'image/png', 'characters', 'new', { projectId: e.id, itemId: variant.id }),
    libraryKind: 'characters', libraryId: entry.id, variantId: variant.id, target: pictureTargetSnapshot(card) }
  const controller = new AbortController()
  const projects = { save: async (id, update) => {
    if (failure === '保存失败') throw Error('保存失败')
    if (failure === '取消') controller.abort(Error('取消'))
    return e.store.save(id, p => { if (failure === '过期') p.library.characters.at(-1).variants[0].fields.age = '八十岁'; return update(p) })
  } }
  await assert.rejects(applyLibraryImageDraft(e.home, projects, root, draft, controller.signal), /修改|取消|保存失败/)
  assert.equal((await e.store.read(e.id)).library.characters.at(-1).variants[0].image.content.assetId, old.assetId)
  assert.deepEqual(await readdir(join(e.home, 'storages/meiji/assets/characters')), [old.assetId])
  assert.ok(await readImageDraft(e.home, draft.draftId))
  assert.equal((await readPicture(e.home, root, old)).bytes.toString(), 'old')
})


test('默认服装不随数组顺序或场景改变，换装须有本镜原文且承接最近已通过镜头', () => {
  const { p, shot, card } = dressed()
  card.defaultCostumeId = 'daily'
  const person = shot.seconds.content.participants[0]
  const parse = () => parseSecondsResponse(JSON.stringify({ shots: [shot.seconds.content] }), [shot], p)
  assert.throws(parse, /无明确服装依据/)
  person.costumeId = 'daily'; person.outfit = '蓝色短衣'
  card.costumes.reverse()
  assert.equal(secondsCharacterRoster(p, shot.id)[0].currentCostumeId, 'daily')
  assert.doesNotThrow(parse)
  person.costumeId = 'night'; person.outfit = '黑色长袍'
  person.costumeEvidence = '他穿上黑色长袍'
  assert.throws(parse, /逐字引用/)
  shot.content += '他穿上黑色长袍。'
  assert.doesNotThrow(parse)
  const next = structuredClone(shot); next.id = 'S02'
  p.shots.items = [shot, next]
  shot.seconds.check.passed = false
  assert.equal(secondsCharacterRoster(p, next.id)[0].currentCostumeId, 'daily')
  shot.seconds.check.passed = true
  assert.equal(secondsCharacterRoster(p, next.id)[0].currentCostumeId, 'night')
  assert.equal(secondsCharacterRoster(p, next.id)[0].confirmedOutfit, '黑色长袍')
})
