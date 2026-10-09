import { actionRequest } from '../client/goal-request.js'
import { promptData } from './fixtures/prompt-data.js'
import { reviewPass } from './fixtures/review-result.js'
import { node, cardModel, shotModel, pictureOf } from '../shared/drama-model.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateStoryPackage } from './fixtures/story-generation.js'
import { preserveStoryAssets } from '../shared/preserve-story-assets.js'
import { projectStore } from '../server/data/project-store.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { runOperation } from './fixtures/operation.js'
import { tabs, tabOf, canGenerate } from '../client/flow-view.js'
import { storyPackageFixture, outlineFixture, outlineResponse, storyRequest } from './fixtures/story-package.js'

test('outline, characters and scenes use separate generation and review requests', async () => {
  let calls = 0
  const generated = { ...storyPackageFixture(), outline: outlineFixture('旅人进入山洞，发现陌生脚印，决定循迹寻找失踪同伴。', 'en') }
  const replies = [JSON.stringify(generated.outline), reviewPass, JSON.stringify(generated.characters), reviewPass, JSON.stringify(generated.scenes), reviewPass]
  const result = await generateStoryPackage({ project: { ...episodeFixture(), outputLanguage: 'en' }, route: { baseUrl: 'http://model.test', apiKey: 'test', model: 'test' }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.match(body.messages[1].content, /输出语言：English/)
    calls++
    if (calls === 2) {
      assert.deepEqual(promptData(body.messages[1].content, '【本次待审内容】'), generated.outline)
    }
    if (calls > 2) assert.match(body.messages[1].content, /旅人进入山洞，发现陌生脚印/)
    if (calls === 1) {
      assert.match(body.messages[0].content, /顶层直接为非空数组/)
      assert.equal(body.response_format, undefined)
      assert.doesNotMatch(body.messages[0].content, /### 角色卡|### 场景卡/)
    }
    if (calls === 3) assert.match(body.messages[0].content, /participants.*参与人物范围/s)
    if (calls === 5) assert.match(body.messages[0].content, /按实际空间覆盖建卡/)
    return Response.json({ choices: [{ message: { content: replies.shift() } }] })
  } })
  assert.deepEqual(result.outline, generated.outline)
  assert.equal(calls, 6)
  assert.equal(result.characters.items.length, 1)
  assert.equal(result.scenes.items.length, 1)
  assert.equal(result.check.passed, true)
})

test('stable identity and confirmed media survive reordering; invented URLs are discarded', () => {
  const original = { ...episodeFixture(), plot: { ...episodeFixture().plot, characters: { items: [cardModel({ id: 'C04', name: '原角色', type: 'role', localPath: '/plugins/meiji/asset-file?category=characters&id=saved', assetId: 'saved', clothes: [{ id: 'cloth' }] })] }, scenes: { items: [] } } }
  const merged = preserveStoryAssets(original, { check: { passed: true, failures: [] }, outline: '新大纲', characters: { items: [{ id: 'C01', name: '新人', imageUrl: 'https://fake.test/a', localPath: '/fake', file: { url: 'https://fake.test/a' } }, { id: 'C02', name: '原角色', appearance: '新描述' }] }, scenes: { items: [] } })
  assert.equal(merged.characters.items[0].id, 'C05')
  assert.equal(merged.characters.items[0].image.content, null)
  assert.equal(JSON.stringify(merged).includes('fake'), false)
  assert.equal(merged.characters.items[1].id, 'C04')
  assert.equal(merged.characters.items[1].appearance, '新描述')
  assert.equal(merged.characters.items[1].image.content.assetId, 'saved')
  assert.deepEqual(merged.characters.items[1].clothes, [{ id: 'cloth' }])
})

test('剧情逐步骤保存失败稿，前项成功保留，依赖失败项的后项不执行且不影响另一集', async t => {
  const e = await setupModel(t), other = blankEpisode({ summary: '别集', durationSeconds: 10 })
  await e.store.save(e.id, { episodes: [(await e.store.read(e.id)).episodes[0], other] })
  await e.store.save(e.id, root => { root.episodes[1].summary.basis = { ...root.episodes[1].summary.basis, scriptSyncedRevision: root.episodes[1].summary.revision }; return root })
  const before = (await e.store.read(e.id)).episodes[1], fixture = storyPackageFixture()
  await runOperation(e.op('story'), { home: e.home, request: storyRequest(fixture) })
  await assert.rejects(runOperation(e.op('characters'), { home: e.home, request: storyRequest(fixture, (kind, _message, phase) => kind === 'characters' && phase === 'review' ? '{"passed":false,"issues":[{"location":"人物","reason":"缺少身份","requirement":"补全身份"}]}' : undefined) }), /自审未通过/)
  const saved = await e.read()
  assert.deepEqual(saved.plot.outline.content, fixture.outline)
  assert.equal(saved.plot.outline.check.passed, true)
  assert.equal(saved.plot.characters.check.passed, false)
  // 不再生成场景和道具；人物审核失败后也不自动补图。
  assert.equal(saved.plot.scenes.check.passed, null)
  assert.deepEqual(saved.plot.scenes.items, [])
  assert.equal(saved.plot.props.items.length, 0)
  assert.equal(saved.shots.items.length, 0)
  assert.equal(saved.assembly.content, null)
  assert.equal(canGenerate(saved, 'shots'), true)
  assert.deepEqual((await e.store.read(e.id)).episodes[1], before)
  await assert.rejects(runOperation(e.op('story'), { home: e.home, request: async () => { throw new Error('返回数据不完整') } }), /返回数据不完整/)
  assert.equal((await e.read()).plot.outline.content, null)
})

test('characters and scenes are generated from the plot tab and shown in the episode assets tab', () => {
  assert.deepEqual(tabs.map(t => t.id), ['script', 'assets', 'shots', 'seconds', 'film', 'assembly'])
  assert.equal(tabOf({ summary: { content: '摘要', check: { passed: true } }, plot: {} }), 'script')
  assert.equal(canGenerate({ outline: '大纲' }, 'characters'), false)
})

async function withOldStory(t) {
  const e = await setupModel(t)
  await e.store.save(e.id, root => {
    const episode = root.episodes[0]
    episode.supplementalSkills = { outline: [{ id: 'rule', content: '保留本集补充' }] }
    episode.plot.props.items = [cardModel({ id: 'P01', name: '旧道具', type: 'prop', category: 'prop', description: '旧道具正文' })]
    for (const key of ['characters', 'scenes', 'props']) {
      const item = episode.plot[key].items[0]
      item.image = node(`image:${item.id}`, { assetId: `old-${key}`, localPath: `/old/${key}` })
      item.parts = { clothes: node(`image:${item.id}:clothes`, { assetId: 'old-part' }) }
    }
    episode.pendingImages = { old: { draftId: 'old', itemId: 'C01' } }
    episode.assembly = node('assembly', { file: 'old.mp4' })
    return root
  })
  return e
}

function assertEmptyStory(project) {
  assert.deepEqual(project.plot.outline.content, null)
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(project.plot[key].items, [])
  assert.deepEqual(project.pendingImages, {})
  assert.deepEqual(project.shots.items, [])
  assert.equal(project.assembly.content, null)
}

test('regenerate clears old story before requests and extracts same-name cards without old media', async t => {
  const e = await withOldStory(t), before = await e.read()
  const generated = storyPackageFixture()
  generated.props = { items: [{ name: '旧道具', category: 'prop', description: '本轮新道具', evidence: '新大纲提到', ownerId: 'C01' }] }
  const replies = [outlineResponse(), reviewPass, JSON.stringify(generated.characters), reviewPass, JSON.stringify(generated.scenes), reviewPass]
  let calls = 0
  await runOperation(e.op('story', { generationMode: 'regenerate' }), { home: e.home,
    request: async () => {
      if (!calls++) {
        assertEmptyStory(await e.read())
      }
      return replies.shift()
    },
  })
  assert.deepEqual((await e.read()).plot.characters.items, [])
  await runOperation(e.op('characters'), { home: e.home, request: async () => { calls++; return replies.shift() } })
  const after = await e.read()
  assert.equal(calls, 4)
  for (const key of ['characters']) {
    assert.equal(after.plot[key].items.length, 1)
    assert.ok(!after.plot[key].items[0].image.content?.assetId)
    assert.ok(!after.plot[key].items[0].image.content?.localPath)
    assert.ok(Object.values(after.plot[key].items[0].parts).every(part => part.content === null))
  }
  assert.deepEqual(after.plot.scenes.items, [])
  assert.deepEqual(after.plot.props.items, [])
  assert.equal(after.summary.content, '展示摘要'); assert.equal(after.summary.outlineRevision, after.plot.outline.revision)
  assert.deepEqual(after.supplementalSkills, before.supplementalSkills)
})

for (const phase of ['first-request', 'characters', 'cancel']) test(`regenerate does not restore old cards after ${phase}`, async t => {
  const e = await withOldStory(t), controller = new AbortController()
  let calls = 0
  if (phase === 'characters') await runOperation(e.op('story'), { home: e.home, request: async message => message.skill === 'review' ? reviewPass : outlineResponse() })
  await assert.rejects(runOperation(e.op(phase === 'characters' ? 'characters' : 'story', { generationMode: 'regenerate' }), { home: e.home, signal: controller.signal,
    request: async () => {
      calls++
      if (phase === 'cancel') {
        controller.abort(new Error('本轮停止'))
        throw controller.signal.reason
      }
      throw new Error('HTTP 503')
    },
  }), /HTTP 503|本轮停止/)
  const after = await e.read()
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(after.plot[key].items, [])
  assert.deepEqual(after.shots.items, [])
  assert.deepEqual(after.pendingImages, {})
  assert.equal(after.assembly.content, null)
  if (phase === 'characters') assert.deepEqual(after.plot.outline.content, outlineFixture())
  else assert.deepEqual(after.plot.outline.content, null)
})

test('outline modification deletes dependent cards and retains history', async t => {
  const e = await withOldStory(t), before = await e.read()
  await runOperation(e.op('story', { only: 'outline', generationMode: 'modify', review: '调整剧情节奏' }), { home: e.home,
    request: async ({ skill }) => skill === 'review' ? reviewPass : JSON.stringify(skill === 'outline' ? storyPackageFixture().outline : storyPackageFixture()[skill.split('-')[0]]),
  })
  assert.equal((await e.read()).plot.characters.items.length, 0)
  assert.ok(before.plot.characters.items[0].image.content)
})
