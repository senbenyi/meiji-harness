import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { savePicture, saveImageDraft, pictureTargetSnapshot } from '../server/data/image-storage.js'
import { pictureRecord } from '../shared/image-assets.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { planRun } from '../shared/run-planner.js'
import { goalRequest } from '../client/goal-request.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { render } from '../server/prompts/skill-prompts.js'
import { characterImageModificationPrompt } from '../server/prompts/interfaces/character-image-interface.js'
import { canGenerate, gateMessage } from '../shared/generation-gates.js'
import { node } from '../shared/drama-model.js'

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

for (const [category,itemId] of [['characters','C01'],['scenes','E01']]) test(`${category} 选用素材图片保持剧情审核及镜头表门禁`, async t => {
  const e=await setupModel(t)
  const ref=await savePicture(e.home,Buffer.from('library image'),'image/png',category,'测试图')
  const before=await e.read()
  await runOperation(e.op('use-asset',{category,itemId,assetId:ref.assetId}),{home:e.home})
  const after=await e.read()
  assert.equal(after.plot[category].items.find(item=>item.id===itemId).image.content.assetId,ref.assetId)
  for (const key of ['outline','characters','scenes','props']) assert.deepEqual(after.plot[key].check,before.plot[key].check)
  assert.equal(canGenerate(after,'shots'),true)
  await e.store.save(e.id,p=>{p.episodes[0].plot.props.check.passed=false;return p})
  await runOperation(e.op('use-asset',{category,itemId,assetId:ref.assetId}),{home:e.home})
  assert.equal(canGenerate(await e.read(),'shots'),true)
  assert.doesNotMatch(gateMessage(await e.read(),'shots'),/道具自审未通过/)
})

test('缺少道具时服务端仍允许镜头表生成并按空集合处理', async t => {
  const e=await setupModel(t)
  await e.store.save(e.id,p=>{delete p.episodes[0].plot.props;return p})
  const { generateShots } = await import('../server/flow/tasks/text/task-shot-table.js')
  await runOperation(e.op('shot-table', {}), { home: e.home, generateShots: options => generateShots({ ...options, request: async message => message.skill === 'review' ? reviewPass : JSON.stringify({ shots: [{ shotId: 'S01', durationSeconds: 5, title: '空道具镜头一', content: '人物走过空旷场景。' }, { shotId: 'S02', durationSeconds: 5, title: '空道具镜头二', content: '人物离开场景。' }] }) }) })
  const after=await e.read()
  assert.equal(canGenerate(after,'shots'),true)
})

for (const draft of [false, true]) test(`人物修改直接提交意见和${draft ? '待确认' : '已确认'}原图 Base64，不改写人物卡`, async t => {
  const e = await fixture(t, draft)
  await e.store.saveReviewDraft(e.id, e.episodeId, 'image:C01', '将头发改为黑色短发', 0)
  const before = await e.read()
  const operation = e.op('character-image', { itemId: 'C01', generationMode: 'modify', review: '将头发改为黑色短发', aspect: '1000x1504', ...(draft ? { draftId: e.draftId } : {}) })
  assert.deepEqual(planSteps(before, operation), [['image', 'image:C01', 'image'], ['wait_confirm', 'image:C01', null]])
  let called = 0
  await runOperation(operation, { home: e.home, waitForBackground: true, submitAssetImage: async args => {
    called++
    assert.equal(args.referenceBytes, undefined)
    assert.deepEqual(args.referenceBase64, [`data:image/png;base64,${Buffer.from(draft ? 'candidate' : 'confirmed').toString('base64')}`])
    assert.match(args.prompt, /你是一名写实电影剧照摄影师/)
    assert.match(args.prompt, /【本次修改意见】\n将头发改为黑色短发/)
    assert.match(args.prompt, /1000 × 1504 像素/)
    const pendingImage = await saveImageDraft(e.home, Buffer.from('edited'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId, itemId: 'C01', prompt: args.prompt })
    const result = { ...args.assets, items: args.assets.items.map(item => ({ ...item, pendingImage })) }
    await args.onSaved(result)
    return result
  } })
  const after = await e.read()
  assert.equal(called, 1)
  assert.equal(after.plot.characters.items[0].image.review.text, '')
  assert.equal(after.plot.characters.items[0].image.review.revision, before.plot.characters.items[0].image.review.revision + 1)
  assert.notEqual(after.plot.characters.items[0].image.status, 'passed')
  await assert.rejects(e.store.saveReviewDraft(e.id, e.episodeId, 'image:C01', '迟到的旧意见', before.plot.characters.items[0].image.review.revision), /意见已更新/)
  assert.equal(after.plot.characters.items[0].look, before.plot.characters.items[0].look)
  assert.equal(after.plot.characters.items[0].image.content.assetId, before.plot.characters.items[0].image.content.assetId)
  assert.equal(Object.keys(after.pendingImages).length, 1)
})

test('人物修改缺少原图时报错，场景修改也使用图片步骤', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('character-image', { itemId: 'C01', generationMode: 'modify', review: '改头发' }), { home: e.home, waitForBackground: true, submitAssetImage: () => assert.fail('不应提交') }), /原来的数据|原图/)
  assert.deepEqual(planSteps(await e.read(), e.op('scene-image', { itemId: 'E01', generationMode: 'modify', review: '镜头后退' })), [['image', 'image:E01', 'image'], ['wait_confirm', 'image:E01', null]])
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


test('人物修改真实生成通路在生图步骤内执行三个动作并登记候选图', async t => {
  const { submitAssetImage } = await import('../server/flow/steps/shared/image-files.js')
  const e = await fixture(t)
  const operation = e.op('character-image', { itemId: 'C01', generationMode: 'modify', review: '背景改为白色' })
  await runOperation(operation, { home: e.home, operationId: 'image-three-nodes', waitForBackground: true,
    submitAssetImage: args => submitAssetImage({ ...args, backend: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-only', model: 'elysium-image' },
      fetchImpl: async (_url, options) => options.method === 'POST' ? Response.json({ data: [{ url: '/v1/media/edited' }] }) : new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    }),
  })
  const task = await latestRun(e.home, e.id, 'image:C01')
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.kinds, ['image', 'wait_confirm'])
  assert.deepEqual(task.steps[0].attempts.map(step => [step.kind, step.status, step.target]), ['image_generate', 'image_download', 'image_save'].map(kind => [kind, 'done', 'image:C01']))
  assert.equal(Object.keys((await e.read()).pendingImages).length, 1)
})

// 图片目标规划为「生图 → 等待人工确认」两步；生成、下载、保存是生图步骤内部的三个动作。
function planSteps(view, operation) { return planRun(view, goalRequest(operation.action, operation).goal).steps.map(step => [step.kind, step.target, step.queue]) }
