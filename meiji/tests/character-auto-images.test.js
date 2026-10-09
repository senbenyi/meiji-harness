import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { storyPackageFixture, storyRequest } from './fixtures/story-package.js'
import { useWorkspaces } from './fixtures/host.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { saveImageDraft, savePicture, pictureTargetSnapshot, readImageDraft, applyImageDraft } from '../server/data/image-storage.js'
import { assetStore } from '../server/data/asset-library-store.js'
import { pictureRecord } from '../shared/image-assets.js'
import { planRun } from '../shared/run-planner.js'
import { scopeProjects } from '../server/data/episode-data.js'

const sessionId = 'session-11111111-1111-4111-8111-111111111111'
async function generated(e, args) {
  const pendingImage = await saveImageDraft(e.home, Buffer.from(`generated-${args.itemId}`), 'image/png', 'characters', args.itemId, { source: 'generated', projectId: e.id, episodeId: e.episodeId, itemId: args.itemId, prompt: args.prompt })
  const result = { ...args.assets, items: args.assets.items.map(item => item.id === args.itemId ? { ...item, pendingImage } : item) }
  await args.onSaved(result)
  return result
}
async function setup(t, onImage) {
  const e = await setupModel(t); useWorkspaces(t)
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const fixture = storyPackageFixture()
  const other = { ...fixture.characters.items[0], id: 'C02', name: '同行人' }
  fixture.characters.items.push(other)
  const service = createRunService({ home: e.home, deps: { request: storyRequest(fixture), submitAssetImage: args => onImage(e, args) } })
  t.after(() => service.dispose())
  return { ...e, service, start: async () => {
    const { run } = await service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'characters' }, mode: 'regenerate' } }, sessionId)
    await service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
    return run.id
  } }
}

test('真实人物 Run 复用已有项目角色图，只为缺图人物自动入库使用', async t => {
  const seen = [], e = await setup(t, async (e, args) => { seen.push(args.itemId); return generated(e, args) })
  const old = await savePicture(e.home, Buffer.from('old'), 'image/png', 'characters', '旅人')
  await e.store.save(e.id, root => {
    root.episodes[0].plot.characters.items[0] = pictureRecord({ ...root.episodes[0].plot.characters.items[0], ...old })
    return root
  })
  // 同名人物先建立关联库与另一集，用真实提取步骤合并到相同库变体。
  const { mergeLibraryGroup } = await import('../shared/library-rules.js')
  const view = await e.read(), linked = mergeLibraryGroup(view, 'characters', view.plot.characters)
  await scopeProjects(e.store, e.episodeId).save(e.id, linked)
  const other = episodeFixture(), current = await e.read()
  other.plot.characters.items = [structuredClone(current.plot.characters.items[0])]
  await e.store.save(e.id, root => ({ ...root, episodes: [...root.episodes, other] }))
  const id = await e.start(); await e.service.drain()
  const done = await e.service.get(e.id, id, sessionId), saved = await e.read()
  assert.equal(done.status, 'completed', JSON.stringify(done.failure))
  assert.deepEqual(seen, [saved.plot.characters.items.find(item => item.name === '同行人').id])
  assert.ok(!done.steps.some(step => step.kind === 'wait_confirm'))
  assert.deepEqual(saved.pendingImages, {})
  for (const card of saved.plot.characters.items) {
    assert.equal(card.image.check.passed, true); assert.equal(card.image.status, 'passed')
    assert.ok(card.image.content.assetId); assert.equal(card.image.content.assetId === old.assetId, card.name === '旅人')
    const file = await assetStore(e.home).file('characters', card.image.content.assetId)
    assert.equal((await readFile(file.path)).toString(), card.name === '旅人' ? 'old' : `generated-${card.id}`)
    const root = await e.store.read(e.id), entry = root.library.characters.find(entry => entry.id === card.ref.libraryId)
    assert.equal(entry.variants.find(v => v.id === card.ref.variantId).image.content.assetId, card.image.content.assetId)
  }
  const root = await e.store.read(e.id)
  assert.equal(root.episodes[1].plot.characters.items[0].image.content.assetId, saved.plot.characters.items[0].image.content.assetId)
  assert.ok(await assetStore(e.home).file('characters', old.assetId))
})

test('人物任务在图片实际保存结束前保持运行；生图失败保留已成功图片', async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers()
  let calls = 0
  const e = await setup(t, async (e, args) => {
    if (++calls === 1) return generated(e, args)
    entered.resolve(); await gate.promise; throw new Error('图片服务失败')
  })
  const id = await e.start(); await entered.promise
  const active = await e.service.get(e.id, id, sessionId)
  assert.equal(active.status, 'running')
  const first = (await e.read()).plot.characters.items.find(card => card.image.content?.assetId)
  assert.ok(first)
  gate.resolve(); await e.service.drain()
  const done = await e.service.get(e.id, id, sessionId)
  assert.equal(done.status, 'failed'); assert.match(done.failure.message, /图片服务失败/)
  assert.equal((await e.read()).plot.characters.items.find(card => card.id === first.id).image.content.assetId, first.image.content.assetId)
  assert.deepEqual((await e.read()).pendingImages, {})
})

test('单卡/库生图保持人工确认，默认剧情不会自动生成人物或图片', async t => {
  const e = await setupModel(t), view = await e.read()
  const manual = planRun(view, { to: 'images', scope: { itemIds: ['C01'] }, mode: 'regenerate' })
  assert.ok(manual.steps.some(step => step.kind === 'wait_confirm'))
  assert.ok(manual.steps.every(step => !step.input.operation?.autoSave))
  assert.deepEqual(planRun(view, { to: 'story', mode: 'regenerate' }).steps.map(step => step.target), ['outline', 'outline', 'summary'])
})

for (const failure of ['保存失败', '取消', '资料过期']) test(`自动入库${failure}保留旧图、旧候选，并清理未使用的新素材`, async t => {
  const e = await setupModel(t)
  const old = await savePicture(e.home, Buffer.from('old'), 'image/png', 'characters', '旅人')
  await e.store.save(e.id, root => { root.episodes[0].plot.characters.items[0] = pictureRecord({ ...root.episodes[0].plot.characters.items[0], ...old }); return root })
  const view = await e.read(), card = view.plot.characters.items[0]
  const pending = await saveImageDraft(e.home, Buffer.from('old-candidate'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId, itemId: card.id })
  await e.store.save(e.id, root => { root.episodes[0].pendingImages[pending.draftId] = { ...pending, itemId: card.id }; return root })
  const draft = await saveImageDraft(e.home, Buffer.from('new'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId, itemId: card.id })
  const controller = new AbortController(), projects = scopeProjects(e.store, e.episodeId)
  const save = projects.save.bind(projects)
  projects.save = (...args) => {
    if (failure === '保存失败') throw new Error('保存失败')
    if (failure === '取消') { controller.abort(new Error('取消')); return save(...args) }
    return save(...args)
  }
  if (failure === '资料过期') await e.store.save(e.id, root => { root.episodes[0].plot.characters.items[0].name = '新名字'; return root })
  await assert.rejects(applyImageDraft(e.home, projects, view, { ...draft, key: 'characters', itemId: card.id, target: pictureTargetSnapshot(card) }, controller.signal))
  const after = await e.read()
  assert.equal(after.plot.characters.items[0].image.content.assetId, old.assetId)
  assert.ok(after.pendingImages[pending.draftId])
  assert.equal((await assetStore(e.home).list('characters')).length, 1)
  assert.equal((await readImageDraft(e.home, pending.draftId)).bytes.toString(), 'old-candidate')
})

test('本集空角色列表残留通过状态时，生成任务实际提取并保存人物和图片', async t => {
  const seen = [], e = await setup(t, async (env, args) => { seen.push(args.itemId); return generated(env, args) })
  await scopeProjects(e.store, e.episodeId).save(e.id, p => {
    p.plot.characters.items = []
    p.plot.characters.check.passed = true
    return { plot: p.plot }
  })
  const before = await e.read()
  assert.equal(before.plot.characters.items.length, 0)
  assert.equal(before.plot.characters.check.passed, true)
  const { run } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'characters' }, mode: 'generate' } }, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
  await e.service.drain()
  const done = await e.service.get(e.id, run.id, sessionId), saved = await e.read()
  assert.equal(done.status, 'completed', JSON.stringify(done.failure))
  assert.deepEqual(done.steps.filter(step => step.target === 'characters').map(step => [step.kind, step.status]), [['generate', 'done'], ['review', 'done']])
  assert.deepEqual(saved.plot.characters.items.map(item => item.name), ['旅人', '同行人'])
  assert.equal(saved.plot.characters.check.passed, true)
  assert.equal(seen.length, 2)
  assert.ok(saved.plot.characters.items.every(item => item.image.content?.assetId))
  assert.ok(!done.steps.some(step => step.kind === 'wait_confirm'))
})
