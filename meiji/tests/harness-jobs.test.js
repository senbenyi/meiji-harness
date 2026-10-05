import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarnessJobs, operationResult } from '../server/host/harness-jobs.js'
import { fakeJobs } from './fixtures/fake-jobs.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { setupModel } from './fixtures/model.js'
import { linkStore } from '../server/data/workspace-links.js'
import { useWorkspaces } from './fixtures/host.js'
const sessionId = 'session-11111111-1111-4111-8111-111111111111'
import { subscribeProject } from '../server/data/project-events.js'

async function setup(t, options = {}) {
  const e = await setupModel(t), jobs = fakeJobs(options), manager = createOperationManager({ home: e.home, execute: options.execute || (async () => []), limitOf: () => 1 })
  useWorkspaces(t)
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const adapter = createHarnessJobs({ home: e.home, manager, registry: jobs, subscribeProject, readProject: id => e.store.read(id) })
  t.after(() => { adapter.dispose(); manager.dispose() })
  return { ...e, jobs, manager, adapter }
}

test('统一登记只启动一次、输出进度、逐字段结果与 manager 一致', async t => {
  let runs = 0; const e = await setup(t, { execute: async () => { runs++; const trace = []; trace.result = { scriptRevision: 3, pendingProposal: '方案' }; return trace } })
  const result = await e.adapter.start(e.op('shot-table', { sessionId: sessionId, origin: 'session', callId: 'call' }))
  await e.jobs.wait(result.jobId, 5000, sessionId)
  const read = e.jobs.read(result.jobId, sessionId), operation = await e.manager.get(result.operationId, sessionId)
  assert.equal(runs, 1); assert.deepEqual(JSON.parse(read.result), operationResult(operation))
  assert.match(read.chunks[0].text, /镜头表：completed/)
  assert.equal(e.jobs.rows.get(result.jobId).outputLimitBytes, 16384)
})

test('普通停止统一 manager.cancel，owner/service teardown 只脱离', async t => {
  for (const reason of ['用户停止', 'owner disposed', 'jobs service disposed']) {
    const gate = Promise.withResolvers(), e = await setup(t, { execute: async (_op, { signal }) => { await Promise.race([gate.promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]); return [] } })
    const result = await e.adapter.start(e.op('shot-table', { sessionId: sessionId, origin: 'session' }))
    e.jobs.kill(result.jobId, sessionId, reason); await e.jobs.wait(result.jobId, 5000, sessionId)
    assert.equal(e.jobs.get(result.jobId, sessionId).status, 'killed')
    gate.resolve(); const final = await e.manager.whenEnded(result.operationId, { sessionId: sessionId })
    assert.equal(final.status, reason === '用户停止' ? 'cancelled' : 'completed')
  }
})

test('登记失败不启动操作；业务拒绝不误当登记失败、不保留运行 job', async t => {
  const e = await setup(t, { rejectStart: () => true })
  await assert.rejects(e.adapter.start(e.op('shot-table', { sessionId: sessionId })), { code: 'JOBS_UNAVAILABLE' })
  assert.deepEqual(e.manager.list(e.id), [])
  const other = await setup(t)
  await other.store.save(other.id, root => { delete root.episodes[0].summary.basis.scriptSyncedRevision; return root })
  await assert.rejects(other.adapter.start(other.op('story', { sessionId: undefined })), { code: 'SCRIPT_PENDING' })
  assert.equal(other.jobs.rows.size, 0)
})

test('占用等待的取消不停止占用者，面板 job 守卫拒绝模型停止', async t => {
  const gate = Promise.withResolvers(), e = await setup(t, { execute: async () => { await gate.promise; return [] } })
  const parent = await e.adapter.start(e.op('shot-table', { origin: 'panel', sessionId: sessionId }))
  assert.match(e.adapter.guard({ name: 'job_kill', arguments: { job_id: parent.jobId } }), /面板/)
  const wait = e.adapter.waitBusy(e.id, parent.operationId, sessionId)
  e.jobs.kill(wait.jobId, sessionId, '取消等待'); await e.jobs.wait(wait.jobId, 5000, sessionId)
  assert.equal(e.manager.list(e.id).length, 1)
  gate.resolve(); await e.manager.whenEnded(parent.operationId)
})

test('自动回写只绑定已有 ID，不重复启动业务', async t => {
  const { projectStore } = await import('../server/data/project-store.js')
  const e = await setupModel(t), jobs = fakeJobs(), manager = createOperationManager({ home: e.home, execute: async (op) => {
    if (op.action === 'summary') await e.store.save(e.id, root => { root.episodes[0].summary.content = '新摘要'; root.episodes[0].summary.revision++; return root })
    return []
  } })
  useWorkspaces(t)
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const adapter = createHarnessJobs({ home: e.home, manager, registry: jobs, subscribeProject, readProject: id => projectStore(e.home).read(id) })
  t.after(() => adapter.dispose())
  const parent = manager.start(e.op('summary', { origin: 'session', sessionId }))
  const final = await parent.done
  assert.ok(final.result.scriptSyncOperationId)
  // 同一 ID 再次绑定返回已有观察任务。
  const id = final.result.scriptSyncOperationId, op = { projectId: e.id, action: 'script-sync', origin: 'session' }
  const a = adapter.bind(id, op), b = adapter.bind(id, op)
  assert.equal(a, b); await jobs.wait(a, 5000, sessionId)
  assert.equal(manager.list(e.id).length, 0)
})

test('剧本等待依事件解除；候选图未确认继续等待；取消等待不改业务', async t => {
  const e = await setup(t)
  await e.store.save(e.id, root => { delete root.episodes[0].summary.basis.scriptSyncedRevision; return root })
  const script = e.adapter.waitScript(e.id, sessionId)
  await e.store.save(e.id, root => { root.episodes[0].summary.basis.scriptSyncedRevision = root.episodes[0].summary.revision; return root })
  await e.jobs.wait(script.jobId, 5000, sessionId)
  assert.equal(JSON.parse(e.jobs.read(script.jobId, sessionId).result).resolved[0].kind, 'episode-sync')
  await e.store.save(e.id, root => { root.episodes[0].pendingImages.draft = { itemId: 'C01' }; return root })
  const image = e.adapter.waitImages(e.id, e.episodeId, ['C01'], sessionId)
  await e.store.save(e.id, root => { root.episodes[0].plot.characters.items[0].image.content = { assetId: 'confirmed' }; root.episodes[0].pendingImages = {}; return root })
  await e.jobs.wait(image.jobId, 5000, sessionId)
  assert.equal(JSON.parse(e.jobs.read(image.jobId, sessionId).result).items[0].ready, true)
  const wait = e.adapter.waitImages(e.id, e.episodeId, ['E01'], sessionId)
  e.jobs.kill(wait.jobId, sessionId, '取消等待'); await e.jobs.wait(wait.jobId, 5000, sessionId)
  assert.equal((await e.read()).plot.scenes.items[0].image.content, null)
})

test('已完成短路收集并移除 job，callId 写入操作与任务', async t => {
  const e = await setup(t)
  const result = await e.adapter.start(e.op('story', { sessionId, origin: 'session', mode: 'generate', callId: 'tool-call-id' }))
  assert.equal(result.alreadyCompleted, true); assert.equal(result.status, 'completed'); assert.equal(e.jobs.rows.size, 0)
  const running = await e.adapter.start(e.op('shot-table', { sessionId, origin: 'session', mode: 'regenerate', callId: 'tool-call-id' }))
  await e.jobs.wait(running.jobId, 5000, sessionId)
  const { recordStore } = await import('../server/data/task-store.js'), history = recordStore(e.home, e.id)
  assert.equal((await history.read('operations', running.operationId)).callId, 'tool-call-id')
  assert.ok((await history.list('tasks')).every(task => task.callId === 'tool-call-id'))
})


test('自动回写登记失败仍执行一次并保留原业务结果', async t => {
  let childRuns = 0
  const e = await setup(t, { rejectStart: () => true, execute: async op => {
    if (op.action === 'summary') await e.store.save(e.id, root => { root.episodes[0].summary.content = '改后摘要'; root.episodes[0].summary.revision++; return root })
    if (op.action === 'script-sync') childRuns++
    return []
  } })
  const parent = e.manager.start(e.op('summary', { sessionId, origin: 'session' })), result = await parent.done
  assert.equal(result.status, 'completed'); assert.ok(result.result.scriptSyncOperationId)
  await e.manager.whenEnded(result.result.scriptSyncOperationId)
  assert.equal(childRuns, 1); assert.equal(e.jobs.rows.size, 0)
})

test('失败与审核失败 job 结算为 failed，停止为 killed，返回逐字段失败与重试信息', async t => {
  for (const status of ['failed', 'review_failed', 'cancelled']) {
    const value = { operationId: 'id', projectId: 'p', episodeId: 'e', action: 'story', status, reviewPassed: false, failures: ['项目摘要不可用'], error: '失败原因', tasks: [{ type: 'project-summary', status }], result: { pendingConfirm: true, pendingProposal: '方案', scriptRevision: 2 } }
    const ended = Promise.resolve(value), manager = { onStarted: () => () => {}, start: () => ({ id: 'id', ready: Promise.resolve({}), done: ended }), track: () => ({ snapshot: () => value }), whenEnded: () => ended }
    const jobs = fakeJobs(), adapter = createHarnessJobs({ manager, registry: jobs, subscribeProject: () => () => {} })
    t.after(() => adapter.dispose())
    const result = await adapter.start({ projectId: 'p', action: 'story', sessionId })
    await jobs.wait(result.jobId, 5000, sessionId)
    const read = jobs.read(result.jobId, sessionId)
    assert.equal(read.job.status, status === 'cancelled' ? 'killed' : 'failed')
    assert.deepEqual(JSON.parse(read.result), operationResult(value))
    assert.equal(JSON.parse(read.result).retryable, status === 'cancelled' ? undefined : true)
  }
})
