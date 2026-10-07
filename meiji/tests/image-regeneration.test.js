import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { saveImageDraft, readImageDraft, pictureTargetSnapshot } from '../server/data/image-storage.js'
import { revisionStore } from '../server/data/project-store.js'
import { planRun } from '../shared/run-planner.js'
import { createRunEngine } from '../server/flow/runs/run-engine.js'
import { executeRunStep } from '../server/flow/shared/task-executor.js'
import { occupy, occupant } from '../server/flow/operations/operation-occupancy.js'
import { normalizeRunGoal } from '../shared/run-templates.js'

async function candidate(e, itemId = 'C01') {
 const p = await e.read(), kind = itemId.startsWith('C') ? 'characters' : 'scenes'
 const draft = await saveImageDraft(e.home, Buffer.from('original candidate'), 'image/png', kind, itemId, { projectId: e.id, episodeId: e.episodeId, itemId })
 await e.store.save(e.id, root => {
  root.episodes[0].pendingImages[draft.draftId] = { ...draft, itemId, key: kind, target: pictureTargetSnapshot(p.plot[kind].items.find(item => item.id === itemId)) }
  return root
 })
 return draft
}
async function generated(e, args) {
 const pendingImage = await saveImageDraft(e.home, Buffer.from('new candidate'), 'image/png', args.itemId.startsWith('C') ? 'characters' : 'scenes', args.itemId, { projectId: e.id, episodeId: e.episodeId, itemId: args.itemId })
 const result = { ...args.assets, items: args.assets.items.map(item => item.id === args.itemId ? { ...item, pendingImage } : item) }
 await args.onSaved(result)
 return result
}

for (const [aspect, size] of [['9:16', '768x1344'], ['3:4', '896x1152'], ['1:1', '1024x1024'], ['4:3', '1152x896'], ['16:9', '1344x768'], ['1000x1504', '1000x1504']]) {
 test(`页面画幅 ${aspect} 经真实 Run 提交为 ${size}`, async t => {
  const e = await setupModel(t)
  let called = false
  await runOperation(e.op('image', { itemId: 'C01', aspect, generationMode: 'regenerate' }), { home: e.home, submitAssetImage: async args => {
   called = true; assert.equal(args.aspectRatio, size)
   return generated(e, args)
  } })
  assert.equal(called, true)
  assert.equal(Object.keys((await e.read()).pendingImages).length, 1)
 })
}

test('两个不同卡片在实际对象锁下并发生成并保留各自候选', { timeout: 5000 }, async t => {
 const e = await setupModel(t), goal = { to: 'images', mode: 'regenerate', scope: { itemIds: ['C01', 'E01'] } }
 const steps = planRun(await e.read(), goal, { imageConfirm: false }).steps
 let submitted = 0, release
 const both = new Promise(resolve => { release = resolve })
 const timer = setTimeout(release, 300); t.after(() => clearTimeout(timer))
 const lock = (run, step) => ({ projectId: run.projectId, episodeId: run.episodeId, target: step.target, action: 'run-step', lock: step.scope })
 const engine = createRunEngine({ home: e.home, limitOf: () => 2,
  canAcquireStep: (run, step) => !occupant(e.home, lock(run, step)),
  acquireStep: (run, step) => occupy(e.home, lock(run, step), { id: step.id, label: step.key }),
  execute: (run, step, context) => executeRunStep(run, step, { home: e.home, ...context, submitAssetImage: async args => {
   if (++submitted === 2) release()
   await both
   return generated(e, args)
  } }),
 })
 try {
  const run = await engine.create({ projectId: e.id, episodeId: e.episodeId, goal, steps })
  await engine.confirm(e.id, run.id); await engine.drain()
  const finished = await engine.get(e.id, run.id)
  assert.equal(finished.status, 'completed', JSON.stringify(finished.steps.map(s => s.error)))
  assert.equal(submitted, 2)
  assert.deepEqual(Object.values((await e.read()).pendingImages).map(d => d.itemId).sort(), ['C01', 'E01'])
 } finally { await engine.dispose() }
})

test('图片依赖只比较本卡与本卡候选，资料变化仍拒绝旧结果', async t => {
 const e = await setupModel(t), job = revisionStore(e.store, 'image-job', { action: 'image', episodeId: e.episodeId, itemId: 'C01' })
 await job.read(e.id)
 await candidate(e, 'E01')
 await job.save(e.id, root => root)
 await e.store.save(e.id, root => { root.episodes[0].plot.characters.items[0].look = '已改变的人物外观'; return root })
 await assert.rejects(job.save(e.id, root => root), { status: 409 })
})

test('本卡候选在任务运行中被处理时仍拒绝旧结果', async t => {
 const e = await setupModel(t), old = await candidate(e)
 const job = revisionStore(e.store, 'candidate-job', { action: 'image', episodeId: e.episodeId, itemId: 'C01', draftId: old.draftId })
 await job.read(e.id)
 await e.store.save(e.id, root => { delete root.episodes[0].pendingImages[old.draftId]; return root })
 await assert.rejects(job.save(e.id, root => root), { status: 409 })
})

test('非法比例、过期或错误归属的候选请求不提交生图并保留原候选', async t => {
 const e = await setupModel(t), old = await candidate(e), other = await candidate(e, 'E01')
 for (const aspect of ['21:9', '9/16', 'auto']) assert.throws(() => normalizeRunGoal({ to: 'images', image: { aspect } }), /图片选项无效/)
 for (const patch of [{ aspect: '21:9', draftId: old.draftId }, { draftId: 'missing' }, { draftId: other.draftId }]) {
  await assert.rejects(runOperation(e.op('image', { itemId: 'C01', generationMode: 'regenerate', ...patch }), { home: e.home, submitAssetImage: () => assert.fail('无效请求不能提交') }), /图片选项无效|候选图片已处理或不属于/)
  assert.ok((await e.read()).pendingImages[old.draftId])
  assert.equal((await readImageDraft(e.home, old.draftId)).bytes.toString(), 'original candidate')
 }
})

for (const mode of ['regenerate', 'modify']) for (const outcome of ['success', 'failure', 'cancel']) {
 test(`候选图 ${mode}/${outcome} 只在新候选成功保存后替换`, async t => {
  const e = await setupModel(t), old = await candidate(e), other = await candidate(e, 'E01'), before = await e.read()
  const controller = new AbortController(), operation = e.op('image', { itemId: 'C01', draftId: old.draftId, generationMode: mode, ...(mode === 'modify' ? { review: '背景改白' } : {}) })
  const work = runOperation(operation, { home: e.home, signal: controller.signal, submitAssetImage: async args => {
   assert.ok((await e.read()).pendingImages[old.draftId], '生成期间保留原候选')
   assert.equal((await readImageDraft(e.home, old.draftId)).bytes.toString(), 'original candidate')
   if (mode === 'modify') assert.deepEqual(args.referenceBase64, ['data:image/png;base64,' + Buffer.from('original candidate').toString('base64')])
   else assert.equal(args.referenceBase64, undefined)
   if (outcome === 'failure') throw new Error('模拟图片接口失败')
   if (outcome === 'cancel') { controller.abort(new Error('用户取消')); throw controller.signal.reason }
   return generated(e, args)
  } })
  if (outcome === 'success') await work
  else await assert.rejects(work, /模拟图片接口失败|用户取消/)
  const after = await e.read()
  assert.ok(after.pendingImages[other.draftId])
  assert.deepEqual(after.plot.characters.items[0].image.content, before.plot.characters.items[0].image.content)
  if (outcome === 'success') {
   assert.equal(after.pendingImages[old.draftId], undefined)
   assert.equal(Object.values(after.pendingImages).filter(d => d.itemId === 'C01').length, 1)
   await assert.rejects(readImageDraft(e.home, old.draftId), { code: 'ENOENT' })
  } else {
   assert.ok(after.pendingImages[old.draftId])
   assert.equal((await readImageDraft(e.home, old.draftId)).bytes.toString(), 'original candidate')
  }
 })
}
