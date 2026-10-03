import { promptData } from './fixtures/prompt-data.js'
import { reviewPass } from './fixtures/review-result.js'
import { node, cardModel, shotModel, pictureOf } from '../shared/drama-model.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateStoryPackage } from '../server/flow/operations/story-text-operations.js'
import { preserveStoryAssets } from '../shared/preserve-story-assets.js'
import { projectStore } from '../server/data/project-store.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { tabs, tabOf, canGenerate } from '../client/flow-view.js'
import { storyPackageFixture, outlineFixture, outlineResponse } from './fixtures/story-package.js'

test('outline, characters and scenes use separate generation and review requests', async () => {
  let calls = 0
  const generated = { ...storyPackageFixture(), outline: outlineFixture('旅人进入山洞，发现陌生脚印，决定循迹寻找失踪同伴。', 'en') }
  const replies = [JSON.stringify({ outline: generated.outline }), reviewPass, JSON.stringify(generated.characters), reviewPass, JSON.stringify(generated.scenes), reviewPass, JSON.stringify(generated.props), reviewPass]
  const result = await generateStoryPackage({ project: { ...episodeFixture(), outputLanguage: 'en' }, route: { baseUrl: 'http://model.test', apiKey: 'test', model: 'test' }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.match(body.messages[0].content, /本次生成语言：English/)
    calls++
    if (calls === 2) {
      assert.deepEqual(promptData(body.messages[1].content, '【本次待审内容】'), { outline: generated.outline })
    }
    if (calls > 2) assert.match(body.messages[1].content, /旅人进入山洞，发现陌生脚印/)
    if (calls === 1) {
      assert.match(body.messages[0].content, /顶层仅含 outline/)
      assert.deepEqual(body.response_format, { type: 'json_object' })
      assert.doesNotMatch(body.messages[0].content, /### 角色卡|### 场景卡/)
    }
    if (calls === 3) assert.match(body.messages[0].content, /角色卡覆盖大纲/)
    if (calls === 5) assert.match(body.messages[0].content, /按实际空间覆盖建卡/)
    return Response.json({ choices: [{ message: { content: replies.shift() } }] })
  } })
  assert.equal(result.outline, generated.outline)
  assert.equal(calls, 8)
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

test('package saves atomically to one episode, retains failed content and clears downstream', async t => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-story-package-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const store = projectStore(home)
  const root = await store.create({ title: '测试', summary: '摘要' })
  const one = blankEpisode({ summary: '本集', durationSeconds: 10 })
  const two = blankEpisode({ summary: '别集', durationSeconds: 10 })
  one.plot.outline.content = '原大纲'; one.shots.items = [shotModel({ id: 'S01' })]
  one.plot.characters.items = [cardModel({ id: 'C04', name: '旅人', type: 'role', localPath: '/plugins/meiji/asset-file?category=characters&id=portrait', assetId: 'portrait' })]
  const baseline = await store.save(root.id, { episodes: [one, two] })
  await runOperation({ action: 'outline', projectId: root.id, episodeId: one.id }, { home, generateStoryPackage: async () => ({ ...storyPackageFixture(), check: { passed: false, failures: ['缺少剧情中的另一身份'] } }) })
  const saved = await store.read(root.id)
  assert.deepEqual(saved.episodes[1], baseline.episodes[1])
  const ep = saved.episodes[0]
  assert.equal(ep.plot.outline.content, storyPackageFixture().outline)
  assert.equal(ep.plot.characters.items[0].image.content, null)
  assert.equal(ep.plot.characters.items[0].id, 'C01')
  assert.equal(ep.plot.scenes.items.length, 1)
  assert.equal(ep.shots.items.length, 0)
  assert.equal(ep.assembly.content, null)
  for (const key of ['outline', 'characters', 'scenes']) assert.equal(ep.plot[key].check.passed, false)
  assert.equal(canGenerate(ep, 'shots'), false)
  await assert.rejects(runOperation({ action: 'outline', projectId: root.id, episodeId: one.id }, { home, generateStoryPackage: async () => { throw new Error('返回数据不完整') } }), /返回数据不完整/)
  const after = (await store.read(root.id)).episodes[0]
  assert.equal(after.plot.outline.content, null)
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(after.plot[key].items, [])
})

test('characters and scenes belong to the plot tab without a separate cast tab', () => {
  assert.deepEqual(tabs.map(t => t.id), ['summary', 'script', 'shots', 'seconds', 'film', 'assembly'])
  assert.equal(tabOf({ summary: { content: '摘要' }, plot: {} }), 'script')
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
  assert.equal(project.plot.outline.content, null)
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(project.plot[key].items, [])
  assert.deepEqual(project.pendingImages, {})
  assert.deepEqual(project.shots.items, [])
  assert.equal(project.assembly.content, null)
}

test('regenerate clears old story before requests and extracts same-name cards without old media', async t => {
  const e = await withOldStory(t), before = await e.read()
  const generated = storyPackageFixture()
  generated.props = { items: [{ name: '旧道具', category: 'prop', description: '本轮新道具', evidence: '新大纲提到', ownerId: 'C01' }] }
  const replies = [outlineResponse(), reviewPass, JSON.stringify(generated.characters), reviewPass, JSON.stringify(generated.scenes), reviewPass, JSON.stringify(generated.props), reviewPass]
  let calls = 0
  await runOperation(e.op('outline', { generationMode: 'regenerate' }), { home: e.home,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => {
      if (!calls++) {
        assertEmptyStory(options.project)
        assertEmptyStory(await e.read())
      }
      return replies.shift()
    } }),
  })
  const after = await e.read()
  assert.equal(calls, 8)
  for (const key of ['characters', 'scenes', 'props']) {
    assert.equal(after.plot[key].items.length, 1)
    assert.ok(!after.plot[key].items[0].image.content?.assetId)
    assert.ok(!after.plot[key].items[0].image.content?.localPath)
    assert.ok(Object.values(after.plot[key].items[0].parts).every(part => part.content === null))
  }
  assert.equal(after.plot.props.items[0].description, '本轮新道具')
  assert.deepEqual(after.summary, before.summary)
  assert.deepEqual(after.supplementalSkills, before.supplementalSkills)
})

for (const phase of ['first-request', 'characters', 'cancel']) test(`regenerate does not restore old cards after ${phase}`, async t => {
  const e = await withOldStory(t), controller = new AbortController()
  let calls = 0
  await assert.rejects(runOperation(e.op('outline', { generationMode: 'regenerate' }), { home: e.home, signal: controller.signal,
    generateStoryPackage: options => generateStoryPackage({ ...options, request: async () => {
      calls++
      if (phase === 'characters' && calls <= 2) return calls === 1 ? outlineResponse() : reviewPass
      if (phase === 'cancel') {
        controller.abort(new Error('本轮停止'))
        throw controller.signal.reason
      }
      throw new Error('HTTP 503')
    } }),
  }), /HTTP 503|本轮停止/)
  const after = await e.read()
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(after.plot[key].items, [])
  assert.deepEqual(after.shots.items, [])
  assert.deepEqual(after.pendingImages, {})
  assert.equal(after.assembly.content, null)
  if (phase === 'characters') assert.equal(after.plot.outline.content, outlineFixture())
  else assert.equal(after.plot.outline.content, null)
})

test('outline modification keeps the original cards and confirmed media', async t => {
  const e = await withOldStory(t), before = await e.read()
  await runOperation(e.op('outline', { generationMode: 'modify', review: '调整剧情节奏' }), { home: e.home,
    generateStoryPackage: async ({ project }) => {
      assert.equal(project.plot.characters.items[0].image.content.assetId, 'old-characters')
      return { ...storyPackageFixture(), check: { passed: true, failures: [] } }
    },
  })
  assert.deepEqual((await e.read()).plot.characters.items[0].image.content, before.plot.characters.items[0].image.content)
})
