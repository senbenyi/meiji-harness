import { node, cardModel, shotModel, pictureOf } from '../shared/drama-model.js'
import { episodeFixture } from './fixtures/model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateStoryPackage } from '../server/generate/story.js'
import { preserveStoryAssets } from '../server/data/story-package.js'
import { projectStore } from '../server/data/projects.js'
import { blankEpisode } from '../server/data/episodes.js'
import { runOperation } from '../server/flow/operations/run.js'
import { tabs, tabOf, canGenerate } from '../client/flow-view.js'
import { storyPackageFixture } from './fixtures/story-package.js'

test('one generation response contains all three sections, followed by one package review', async () => {
  let calls = 0
  const generated = { ...storyPackageFixture(), outline: '旅人进入山洞，发现陌生脚印，决定循迹寻找失踪同伴。' }
  const result = await generateStoryPackage({ project: { ...episodeFixture(), outputLanguage: 'en' }, route: { baseUrl: 'http://model.test', apiKey: 'test', model: 'test' }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.match(body.messages[0].content, /本次生成语言：English/)
    calls++
    if (calls === 2) {
      assert.match(body.messages[1].content, /阶段：剧情整包/)
      assert.match(body.messages[1].content, /characters/)
    }
    return Response.json({ choices: [{ message: { content: calls === 1 ? JSON.stringify(generated) : 'PASS' } }] })
  } })
  assert.equal(result.outline, generated.outline)
  assert.equal(calls, 2)
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
  assert.equal(ep.plot.characters.items[0].image.content.assetId, 'portrait')
  assert.equal(ep.plot.characters.items[0].id, 'C04')
  assert.equal(ep.plot.scenes.items.length, 1)
  assert.equal(ep.shots.items.length, 0)
  assert.equal(ep.assembly.content, null)
  for (const key of ['outline', 'characters', 'scenes']) assert.equal(ep.plot[key].check.passed, false)
  assert.equal(canGenerate(ep, 'shots'), false)
  const old = structuredClone(ep)
  await assert.rejects(runOperation({ action: 'outline', projectId: root.id, episodeId: one.id }, { home, generateStoryPackage: async () => { throw new Error('返回数据不完整') } }), /返回数据不完整/)
  const after = (await store.read(root.id)).episodes[0]
  for (const key of ['outline', 'characters', 'scenes']) assert.deepEqual(after.plot[key].content, old.plot[key].content)
})

test('characters and scenes belong to the plot tab without a separate cast tab', () => {
  assert.deepEqual(tabs.map(t => t.id), ['summary', 'script', 'shots', 'seconds', 'film', 'assembly'])
  assert.equal(tabOf({ summary: { content: '摘要' }, plot: {} }), 'script')
  assert.equal(canGenerate({ outline: '大纲' }, 'characters'), false)
})
