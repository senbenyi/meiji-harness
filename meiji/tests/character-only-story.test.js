import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { storyPackageFixture, storyRequest } from './fixtures/story-package.js'
import { reviewPass } from './fixtures/review-result.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { removeSceneData } from '../server/data/remove-scene-data.js'
import { projectStore } from '../server/data/project-store.js'
import { createLibraryEntry } from '../shared/library-rules.js'
import { planRun } from '../shared/run-planner.js'
import { saveImageDraft, readImageDraft } from '../server/data/image-storage.js'
import { historyStore } from '../server/data/history-store.js'

test('剧情真实生成仅大纲；点击人物目标后提取角色，缺场景道具可生成镜头表', async t => {
  const e = await setupModel(t), seen = [], fixture = storyPackageFixture()
  const request = storyRequest(fixture, (kind, _message, phase) => { seen.push([kind, phase]) })
  await runOperation(e.op('story'), { home: e.home, request })
  assert.deepEqual(seen, [['outline', 'generate'], ['outline', 'review']])
  assert.deepEqual((await e.read()).plot.characters.items, [])
  assert.equal(planRun(await e.read(), { to: 'shots' }).blockers.length, 0)
  assert.deepEqual((await latestRun(e.home, e.id)).steps.map(step => step.target), ['outline', 'outline','summary'])
  await runOperation(e.op('characters'), { home: e.home, request })
  assert.deepEqual(seen, [['outline', 'generate'], ['outline', 'review'], ['characters', 'generate'], ['characters', 'review']])
  const story = await latestRun(e.home, e.id)
  assert.ok(story.steps.every(step => !['scenes', 'props', 'images:scenes', 'images:props'].includes(step.target)))
  const view = await e.read()
  assert.deepEqual(view.plot.scenes.items, []); assert.deepEqual(view.plot.props.items, [])
  const plan = planRun(view, { to: 'shots', mode: 'regenerate' })
  assert.equal(plan.prereq.length, 0)
  await runOperation(e.op('shots'), { home: e.home, request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ shots: [{ shotId: 'S01', durationSeconds: 10, title: '发现线索', content: '旅人【旅人|C01】走进庭院，循着脚印靠近大门。' }] }) })
  const saved = await e.read()
  assert.equal(saved.shots.check.passed, true)
  assert.match(saved.shots.items[0].content, /庭院/)
})

test('场景清理删除各集场景、库和候选文件，引用镜头重置；人物/摘要/剧本和历史保留且幂等', async t => {
  const e = await setupModel(t)
  const scene = await saveImageDraft(e.home, Buffer.from('scene'), 'image/png', 'scenes', '庭院', { itemId: 'E01' })
  const character = await saveImageDraft(e.home, Buffer.from('person'), 'image/png', 'characters', '旅人', { itemId: 'C01' })
  const libraryDraft = await saveImageDraft(e.home, Buffer.from('library-scene'), 'image/png', 'scenes', '场景库', {})
  await e.store.save(e.id, root => {
    const library = createLibraryEntry(root, 'scenes', { name: '庭院', look: '庭院背景' })
    root.episodes[0].plot.scenes.items[0].ref = { libraryId: library.entry.id, variantId: library.variant.id }
    root.episodes[0].pendingImages = { [scene.draftId]: { ...scene, itemId: 'E01' }, [character.draftId]: { ...character, itemId: 'C01' } }
    root.pendingImages = { [libraryDraft.draftId]: { ...libraryDraft, libraryKind: 'scenes', libraryId: library.entry.id, variantId: library.variant.id } }
    root.episodes[0].shots.items[0].content = '旅人【旅人|C01】走入庭院【庭院|E01】。'
    const other = episodeFixture(); other.shots.items = []; root.episodes.push(other)
    return root
  })
  const sceneAssets = join(e.home, 'storages', 'meiji', 'assets', 'scenes')
  await mkdir(sceneAssets, { recursive: true }); await writeFile(join(sceneAssets, 'scene.png'), 'scene')
  const charAssets = join(e.home, 'storages', 'meiji', 'assets', 'characters')
  await mkdir(charAssets, { recursive: true }); await writeFile(join(charAssets, 'person.png'), 'person')
  const legacy = join(e.home, 'storages', 'meiji', 'projects', e.id, 'images', e.episodeId)
  await mkdir(legacy, { recursive: true }); await writeFile(join(legacy, 'E01.png'), 'legacy')
  const before = await e.store.read(e.id)
  await historyStore(e.home, e.id).event('existing-history', { target: 'scenes' })
  const history = await historyStore(e.home, e.id).list('events')
  assert.deepEqual(await removeSceneData(e.home), { changedProjects: 1 })
  const after = await projectStore(e.home).read(e.id)
  assert.deepEqual(after.library.scenes, []); assert.deepEqual(after.pendingImages, {})
  for (const episode of after.episodes) {
    assert.deepEqual(episode.plot.scenes.items, []); assert.ok(!episode.plot.scenes.source)
    assert.equal(episode.plot.scenes.operation, null)
  }
  assert.deepEqual(after.episodes[0].shots.items, [])
  assert.deepEqual(after.episodes[0].plot.characters, before.episodes[0].plot.characters)
  assert.deepEqual(after.episodes[0].summary, before.episodes[0].summary)
  assert.equal(after.script, before.script)
  assert.deepEqual(await historyStore(e.home, e.id).list('events'), history)
  assert.deepEqual(Object.keys(after.episodes[0].pendingImages), [character.draftId])
  await assert.rejects(readImageDraft(e.home, scene.draftId), { code: 'ENOENT' })
  await assert.rejects(readImageDraft(e.home, libraryDraft.draftId), { code: 'ENOENT' })
  assert.equal((await readImageDraft(e.home, character.draftId)).bytes.toString(), 'person')
  await assert.rejects(access(sceneAssets), { code: 'ENOENT' }); await assert.rejects(access(join(legacy, 'E01.png')), { code: 'ENOENT' })
  assert.equal(await readFile(join(charAssets, 'person.png'), 'utf8'), 'person')
  assert.deepEqual(await removeSceneData(e.home), { changedProjects: 0 })
  assert.deepEqual(await e.store.read(e.id), after)
})

test('无项目引用的场景候选也清理，其他类别候选保留', async t => {
  const e = await setupModel(t)
  const orphan = await saveImageDraft(e.home, Buffer.from('orphan'), 'image/png', 'scenes', '孤立场景', {})
  const retained = await saveImageDraft(e.home, Buffer.from('person'), 'image/png', 'characters', '人物', {})
  await removeSceneData(e.home)
  await assert.rejects(readImageDraft(e.home, orphan.draftId), { code: 'ENOENT' })
  assert.equal((await readImageDraft(e.home, retained.draftId)).bytes.toString(), 'person')
})
