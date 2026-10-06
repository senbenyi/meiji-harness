import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { linkStore } from '../server/data/workspace-links.js'
import { operationTools } from '../tools/session-operation-tools.js'
import { planTasks, validateOperation } from '../server/flow/operations/operation-registry.js'
import { imageItems } from '../shared/library-images.js'
import { mergeLibraryGroup } from '../shared/library-rules.js'
import { cardModel, setContent } from '../shared/drama-model.js'
import { createHarnessJobs } from '../server/host/harness-jobs.js'
import { fakeJobs } from './fixtures/fake-jobs.js'
import { subscribeProject } from '../server/data/project-events.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'

async function tools(t) {
  const e = await setupModel(t), sessionId = 'session-11111111-1111-4111-8111-111111111111', calls = []
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const generators = operationTools({ home: e.home, jobs: { start: async op => { calls.push(op); return { status: 'running', jobId: 'job' } } } })
  return { ...e, calls, exec: { callId: 'call', agent: { session: { id: sessionId } } }, tool: name => generators.find(tool => tool.name === 'operation-' + name.replaceAll('_', '-')) }
}

test('会话生成删除确认不启动任务，授权后保留 callId、parts 与 track；单卡图片拒绝', async t => {
  const e = await tools(t), tool = e.tool('generate_film')
  const args = { episodeNumber: 1, mode: 'regenerate', parts: 'video', track: 'S01' }
  // 分镜已有正文，视频重生成会清理后镜依赖；用摘要保证存在可观察删除清单。
  const summary = e.tool('generate_summary'), preview = JSON.parse(await summary.execute({ episodeNumber: 1, mode: 'regenerate' }, e.exec))
  assert.equal(preview.status, 'needs_confirmation'); assert.ok(preview.deletions.length); assert.equal(e.calls.length, 0)
  await summary.execute({ episodeNumber: 1, mode: 'regenerate', confirmDelete: true }, e.exec)
  await tool.execute({ ...args, confirmDelete: true }, e.exec)
  assert.equal(e.calls[1].callId, 'call'); assert.equal(e.calls[1].parts, 'video'); assert.equal(e.calls[1].track, 'S01')
  for (const action of ['character-image', 'scene-image', 'prop-image']) assert.throws(() => validateOperation({ action, origin: 'session' }), { status: 403 })
  for (const invalid of [{ ...args, parts: 'bad' }, { ...args, track: 3 }, { ...args, extra: true }]) await assert.rejects(tool.execute(invalid, e.exec), /参数/)
  await assert.rejects(e.tool('generate_images').execute({ episodeNumber: 1, mode: 'generate', itemIds: ['C01', 'C01'] }, e.exec), /参数/)
})

test('批量图片按三类库判断缺图，已用库图跳过，同变体只发一项，候选阻断', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, root => {
    const ep = root.episodes[0]; ep.plot.props.items = [cardModel({ id: 'P01', type: 'prop', name: '铜灯', description: '祖传铜灯' })]
    for (const kind of ['characters', 'scenes', 'props']) { const merged = mergeLibraryGroup({ ...ep, library: root.library, episodeId: ep.id }, kind, ep.plot[kind]); ep.plot = merged.plot; root.library = merged.library }
    setContent(root.library.characters[0].variants[0].image, { assetId: 'photo' }, { passed: true, failures: [] })
    ep.plot.scenes.items.push({ ...structuredClone(ep.plot.scenes.items[0]), id: 'E02' })
    return root
  })
  let tasks = await planTasks(e.home, e.op('images', { mode: 'generate' }))
  assert.deepEqual(tasks.map(task => task.type), ['scene-image', 'prop-image'])
  const root = await e.store.read(e.id), ep = root.episodes[0]
  assert.deepEqual(imageItems(root, ep).filter(item => !item.ready).map(item => item.itemId), ['E01', 'E02', 'P01'])
  tasks = await planTasks(e.home, e.op('images', { mode: 'regenerate', itemIds: ['C01'] }))
  assert.deepEqual(tasks.map(task => task.type), ['character-image'])
  await e.store.save(e.id, root => { root.pendingImages = { d: { variantId: ep.plot.props.items[0].ref.variantId } }; return root })
  await assert.rejects(planTasks(e.home, e.op('images', { mode: 'generate' })), /候选图/)
})

test('候选生成结果登记图片等待，放弃仍缺图，导入可用库图后等待完成', async t => {
  const e = await setupModel(t), sessionId = 'session-11111111-1111-4111-8111-111111111111'
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const registry = fakeJobs(), manager = createOperationManager({ home: e.home, execute: async () => {
    await e.store.save(e.id, root => { root.episodes[0].pendingImages.d = { itemId: 'C01' }; return root })
    const trace = []; trace.result = { pendingConfirm: true }; return trace
  } })
  const jobs = createHarnessJobs({ home: e.home, manager, registry, subscribeProject, readProject: id => e.store.read(id) })
  t.after(() => { jobs.dispose(); manager.dispose() })
  const started = await jobs.start(e.op('images', { mode: 'generate', itemIds: ['C01'], origin: 'session', sessionId }))
  await registry.wait(started.jobId, 5000, sessionId)
  assert.equal(JSON.parse(registry.read(started.jobId, sessionId).result).pendingConfirm, true)
  const wait = registry.list(sessionId).find(job => job.kind === 'meiji-images'); assert.ok(wait)
  await e.store.save(e.id, root => { delete root.episodes[0].pendingImages.d; return root })
  assert.equal(registry.get(wait.id, sessionId).status, 'running')
  await e.store.save(e.id, root => { const ep = root.episodes[0], merged = mergeLibraryGroup({ ...ep, library: root.library, episodeId: ep.id }, 'characters', ep.plot.characters); root.library = merged.library; ep.plot = merged.plot; setContent(root.library.characters[0].variants[0].image, { assetId: 'imported', source: 'photo' }, { passed: true, failures: [] }); return root })
  await registry.wait(wait.id, 5000, sessionId)
  assert.equal(registry.get(wait.id, sessionId).status, 'completed')
})
