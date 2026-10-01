import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episodes.js'
import { savePicture, saveImageDraft, pictureTargetSnapshot } from '../server/data/pictures.js'
import { pictureRecord } from '../server/generate/image.js'
import { runOperation } from '../server/flow/operations/run.js'
import { planSteps } from '../server/flow/operations/registry.js'
import { previewPrompts } from '../server/prompts/preview.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { render } from '../server/prompts/skill-prompts.js'
import { characterImageModificationPrompt } from '../server/prompts/interfaces/character-image.js'

async function fixture(t, draft = false) {
  const e = await setupModel(t)
  const ref = await savePicture(e.home, Buffer.from('confirmed'), 'image/png', 'characters', '旅人')
  const store = scopeProjects(e.store, e.episodeId)
  await store.save(e.id, p => ({ plot: { ...p.plot, characters: { ...p.plot.characters, items: p.plot.characters.items.map(item => pictureRecord({ ...item, ...ref })) } } }))
  if (draft) {
    const p = await e.read()
    const candidate = await saveImageDraft(e.home, Buffer.from('candidate'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId, itemId: 'C01' })
    e.draftId = candidate.draftId
    await store.save(e.id, { pendingImages: { [candidate.draftId]: { ...candidate, itemId: 'C01', key: 'characters', target: pictureTargetSnapshot(p.plot.characters.items[0]) } } })
  }
  return e
}

for (const draft of [false, true]) test(`人物修改直接提交意见和${draft ? '待确认' : '已确认'}原图 Base64，不改写人物卡`, async t => {
  const e = await fixture(t, draft)
  const before = await e.read()
  const operation = e.op('image', { itemId: 'C01', generationMode: 'modify', review: '将头发改为黑色短发', aspect: '1000x1504', ...(draft ? { draftId: e.draftId } : {}) })
  const steps = await planSteps(e.home, operation)
  assert.deepEqual(steps.map(step => step.kind), ['image_generate', 'image_download', 'image_save'])
  let called = 0
  await runOperation(operation, { home: e.home, waitForBackground: true, submitAssetImage: async args => {
    called++
    assert.equal(args.referenceBytes, undefined)
    assert.deepEqual(args.referenceBase64, [`data:image/png;base64,${Buffer.from(draft ? 'candidate' : 'confirmed').toString('base64')}`])
    assert.match(args.prompt, /你是一名人物角色设计师/)
    assert.match(args.prompt, /【本次修改意见】\n将头发改为黑色短发/)
    assert.match(args.prompt, /1000 × 1504 像素/)
    const pendingImage = await saveImageDraft(e.home, Buffer.from('edited'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId, itemId: 'C01', prompt: args.prompt })
    const result = { ...args.assets, items: args.assets.items.map(item => ({ ...item, pendingImage })) }
    await args.onSaved(result)
    return result
  } })
  const after = await e.read()
  assert.equal(called, 1)
  assert.equal(after.plot.characters.items[0].look, before.plot.characters.items[0].look)
  assert.equal(after.plot.characters.items[0].image.content.assetId, before.plot.characters.items[0].image.content.assetId)
  assert.equal(Object.keys(after.pendingImages).length, 1)
})

test('人物修改缺少原图时报错，场景修改也使用图片步骤', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('image', { itemId: 'C01', generationMode: 'modify', review: '改头发' }), { home: e.home, waitForBackground: true, submitAssetImage: () => assert.fail('不应提交') }), /原来的数据|原图/)
  const scene = await planSteps(e.home, e.op('image', { itemId: 'E01', generationMode: 'modify' }))
  assert.deepEqual(scene.map(step => step.kind), ['image_generate', 'image_download', 'image_save'])
})

test('人物修改预览复用实际 model 的组装，Base64 不显示在预览文本', async t => {
  const e = await fixture(t)
  const view = await e.read()
  const set = builtinSkillSet(view.skills)
  const canvas = { width: 1024, height: 1024 }
  const preview = previewPrompts({ stage: 'character-image', root: {}, view, skillSet: set, canvas }).modify
  const actual = characterImageModificationPrompt(view.plot.characters.items[0], view, { canvas, images: [{ purpose: 'edit-base', base64: 'data:image/png;base64,YQ==' }], instruction: '（此处为人工修改意见）' }, set)
  assert.equal(render(preview.user), actual)
  assert.equal(preview.chars, actual.length)
  assert.doesNotMatch(actual, /base64/)
})


test('人物修改真实生成通路执行三个计划步骤并登记候选图', async t => {
  const { submitAssetImage } = await import('../server/generate/image.js')
  const { recordStore } = await import('../server/data/task-store.js')
  const e = await fixture(t)
  const operation = e.op('image', { itemId: 'C01', generationMode: 'modify', review: '背景改为白色' })
  await runOperation(operation, { home: e.home, operationId: 'image-three-steps', waitForBackground: true,
    submitAssetImage: args => submitAssetImage({ ...args, backend: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-only', model: 'elysium-image' },
      fetchImpl: async (_url, options) => options.method === 'POST' ? Response.json({ data: [{ url: '/v1/media/edited' }] }) : new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    }),
  })
  const task = await recordStore(e.home, e.id).read('tasks', 'image-three-steps')
  const planned = task.steps
  assert.equal(task.status, 'completed')
  assert.deepEqual(planned.map(step => step.kind), ['image_generate', 'image_download', 'image_save'])
  assert.ok(planned.every(step => step.status === 'completed' && !step.unplanned && step.target === 'image:C01'))
  assert.equal(Object.keys((await e.read()).pendingImages).length, 1)
})
