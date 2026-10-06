import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { savePicture, saveImageDraft, pictureTargetSnapshot } from '../server/data/image-storage.js'
import { pictureRecord } from '../shared/image-assets.js'
import { submitAssetImage } from '../server/flow/steps/shared/image-files.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { sceneImagePrompt } from '../server/prompts/interfaces/scene-image-interface.js'

for (const draft of [false, true]) test(`场景意见修改使用${draft ? '待确认' : '已确认'}原图 Base64，不改写资料，执行三步`, async t => {
  const e = await setupModel(t)
  const store = scopeProjects(e.store, e.episodeId)
  const ref = await savePicture(e.home, Buffer.from('confirmed-scene'), 'image/png', 'scenes', '庭院')
  await store.save(e.id, p => ({ plot: { ...p.plot, scenes: { ...p.plot.scenes, items: p.plot.scenes.items.map(item => pictureRecord({ ...item, ...ref })) } } }))
  const before = await e.read()
  let candidate
  if (draft) {
    candidate = await saveImageDraft(e.home, Buffer.from('candidate-scene'), 'image/png', 'scenes', '庭院', { projectId: e.id, episodeId: e.episodeId, itemId: 'E01' })
    await store.save(e.id, { pendingImages: { [candidate.draftId]: { ...candidate, itemId: 'E01', key: 'scenes', target: pictureTargetSnapshot(before.plot.scenes.items[0]) } } })
  }
  const requests = []
  await runOperation(e.op('scene-image', { itemId: 'E01', generationMode: 'modify', review: '镜头后退，扩大安全边距', aspect: '1600x904', ...(candidate ? { draftId: candidate.draftId } : {}) }), {
    home: e.home, operationId: 'scene-modify', waitForBackground: true,
    submitAssetImage: args => submitAssetImage({ ...args, backend: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-only', model: 'elysium-image' }, fetchImpl: async (url, options) => {
      requests.push([url.pathname, options.method])
      if (options.method === 'GET') return new Response(Buffer.from([137, 80, 78, 71]))
      assert.equal(url.pathname, '/v1/images/edits')
      assert.equal(options.body.get('image[]'), `data:image/png;base64,${Buffer.from(draft ? 'candidate-scene' : 'confirmed-scene').toString('base64')}`)
      assert.match(options.body.get('prompt'), /你是一名影视场景设计师/)
      assert.match(options.body.get('prompt'), /"space":"南门北墙"/)
      assert.match(options.body.get('prompt'), /【本次修改意见】\n镜头后退，扩大安全边距/)
      assert.equal(options.body.get('size'), '1600x904')
      return Response.json({ data: [{ url: '/v1/media/scene' }] })
    } }),
  })
  const task = await latestRun(e.home, e.id, 'image:E01')
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.kinds, ['image', 'wait_confirm'])
  assert.deepEqual(task.attempts, ['image_generate', 'image_download', 'image_save'])
  const after = await e.read()
  assert.equal(after.plot.scenes.items[0].look, before.plot.scenes.items[0].look)
  assert.equal(after.plot.scenes.items[0].space, before.plot.scenes.items[0].space)
  assert.equal(after.plot.scenes.items[0].image.content.assetId, before.plot.scenes.items[0].image.content.assetId)
  assert.equal(Object.keys(after.pendingImages).length, 1)
  assert.deepEqual(requests, [['/v1/images/edits', 'POST'], ['/v1/media/scene', 'GET']])
})

test('场景文字生成实际 prompt 等于 model 输出，资料和项目画幅完整传入', async t => {
  const e = await setupModel(t), before = await e.read()
  await runOperation(e.op('scene-image', { itemId: 'E01' }), { home: e.home, waitForBackground: true, submitAssetImage: async args => {
    assert.equal(args.prompt, sceneImagePrompt(before.plot.scenes.items[0], before))
    assert.match(args.prompt, /"space":"南门北墙"/)
    const pendingImage = await saveImageDraft(e.home, Buffer.from('scene'), 'image/png', 'scenes', '庭院', { projectId: e.id, episodeId: e.episodeId, itemId: 'E01' })
    const result = { ...args.assets, items: args.assets.items.map(item => ({ ...item, pendingImage })) }
    await args.onSaved(result)
    return result
  } })
  assert.equal(Object.keys((await e.read()).pendingImages).length, 1)
})

test('场景修改缺少原图或意见时不提交图片请求', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('scene-image', { itemId: 'E01', generationMode: 'modify', review: '镜头后退' }), { home: e.home, waitForBackground: true, submitAssetImage: () => assert.fail('不能提交') }), /原来的数据|原图/)
})
