import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { outlineFixture } from './fixtures/story-package.js'
import { reviewPass } from './fixtures/review-result.js'
import { fakeJobs } from './fixtures/fake-jobs.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { createHarnessRunJobs } from '../server/host/harness-run-jobs.js'
import { linkStore } from '../server/data/workspace-links.js'
import { subscribeProject, notifyProject } from '../server/data/project-events.js'
import { occupy, occupant } from '../server/flow/operations/operation-occupancy.js'
import { runRoutes } from '../server/http/run-routes.js'
import { runStore } from '../server/data/run-store.js'
import { interruptRunning } from '../server/flow/tasks/task-interrupt.js'
import { registerPanel } from '../server/http/panel-routes.js'
import { createQueue } from '../server/flow/tasks/task-queue.js'

const sessionId = 'session-11111111-1111-4111-8111-111111111111'
const gate = () => Promise.withResolvers()
const until = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) } assert.fail('等待状态超时') }
async function setup(t, options = {}) {
  const e = await setupModel(t); useWorkspaces(t)
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const service = createRunService({ home: e.home, ...options })
  const registry = fakeJobs(), jobs = createHarnessRunJobs({ home: e.home, registry, readRun: (...args) => service.get(...args), cancelRun: (...args) => service.cancel(...args), subscribeProject })
  t.after(async () => { jobs.dispose(); await service.dispose() })
  return { ...e, service, registry, jobs, input: { projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } } }
}

test('预览不执行，删除必须确认，客户端指定步骤和锁无效；列表按对象和集过滤且隐藏技能正文', async t => {
  let calls = 0
  const e = await setup(t, { execute: async () => { calls++; return { passed: true } } })
  const { run, deletions } = await e.service.plan({ ...e.input, steps: [{ kind: 'override' }], lock: 'episode' }, sessionId)
  assert.ok(deletions.length)
  assert.equal(calls, 0); assert.equal(run.status, 'draft')
  assert.deepEqual(run.steps.map(step => step.kind), ['generate', 'review'])
  // 锁范围由服务端按对象推导（剧情属于项目级写入），客户端传入的 lock 无效。
  assert.ok(run.steps.every(step => step.scope === 'project'))
  await assert.rejects(e.service.confirm(e.id, run.id, sessionId), { code: 'DELETIONS_PENDING' })
  await assert.rejects(e.service.get(e.id, run.id, 'unbound'), { status: 409 })
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  assert.equal(calls, 2)
  const rows = await e.service.list(e.id, sessionId, { episodeId: e.episodeId, target: 'outline' })
  assert.equal(rows.length, 1); assert.equal(rows[0].done, 2)
  assert.ok(!Object.hasOwn(rows[0], 'steps')); assert.ok(!Object.hasOwn(rows[0], 'skillSnapshot'))
  assert.deepEqual(await e.service.list(e.id, sessionId, { target: 'seconds:S01' }), [])
})

test('预览后下游变化需要重新确认范围，不能执行旧删除授权', async t => {
  const e = await setup(t, { execute: async () => ({ passed: true }) })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.store.save(e.id, current => { current.episodes[0].assembly.content = { file: 'new.mp4', url: 'new' }; return current })
  await assert.rejects(e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }), { code: 'RUN_PREVIEW_CHANGED' })
  assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'draft')
})

test('任务查询支持多对象与通配，项目级只按明确受影响剧集出现', async t => {
  const e = await setup(t)
  const { run } = await e.service.plan(e.input, sessionId)
  await runStore(e.home, e.id).update(run.id, current => {
    current.episodeId = null
    for (const step of current.steps) step.scope = 'project'
    current.affectedEpisodes = [e.episodeId]
    current.steps[0].target = 'film:S03'
    return current
  })
  assert.equal((await e.service.list(e.id, sessionId, { target: 'storyboard:S03,film:S03', episodeId: e.episodeId })).length, 1)
  assert.equal((await e.service.list(e.id, sessionId, { target: 'film:*', episodeId: 'project' })).length, 1)
  assert.equal((await e.service.list(e.id, sessionId, { episodeId: 'another' })).length, 0)
  assert.equal((await e.service.list(e.id, sessionId, { target: 'film:S04' })).length, 0)
})

test('goal 接口用纯规划器生成单步图，镜头表通过后展开新的逐镜目标', async t => {
  const seen = [], e = await setup(t, { execute: async (_, step) => {
    seen.push(step.target)
    if (step.target === 'shots') await e.store.save(e.id, root => { root.episodes[0].shots = structuredClone(e.episode.shots); return root })
    return { passed: true }
  } })
  await e.store.save(e.id, root => { root.episodes[0].shots.items = []; root.episodes[0].shots.check.passed = null; return root })
  const { run } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { from: 'shots', to: 'seconds', mode: 'regenerate' } }, sessionId)
  assert.ok(run.steps.some(step => step.kind === 'expand'))
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const saved = await e.service.get(e.id, run.id, sessionId)
  assert.equal(saved.status, 'completed'); assert.ok(seen.includes('seconds:S01')); assert.ok(seen.includes('seconds:S02'))
})

test('goal 缺前置不调用模型，前置变为满足后原任务可继续', async t => {
  let calls = 0; const e = await setup(t, { execute: async () => { calls++; return { passed: true } } })
  await e.store.save(e.id, root => { root.episodes[0].summary.check.passed = false; return root })
  const { run, prereq } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } }, sessionId)
  assert.ok(prereq.some(item => item.key === 'summary@all'))
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  assert.equal(calls, 0); assert.equal((await e.service.get(e.id, run.id, sessionId)).pause.reasons[0].code, 'prereq_required')
  await e.store.save(e.id, root => { root.episodes[0].summary.check.passed = true; return root }); await e.service.drain()
  assert.equal(calls, 2); assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'completed')
})

test('生图后等待人工确认，不提前运行引用该卡片的成片', async t => {
  const e = await setup(t, { execute: async () => ({}) })
  const { run } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'images', scope: { itemIds: ['C01'] } } }, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const saved = await e.service.get(e.id, run.id, sessionId)
  assert.equal(saved.status, 'paused'); assert.equal(saved.pause.reasons[0].code, 'wait_confirm')
  assert.equal(saved.steps.find(step => step.kind === 'image').status, 'done')
})

test('用户意见重插原目标的下游，不丢同 Run 的制作终点；无关镜头不作废', async t => {
  const e = await setup(t, { execute: async (_, step) => { if (step.target === 'film:S02') throw new Error('等待人工意见'); return { passed: true } } })
  const preview = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { from: 'shots', to: 'film', mode: 'generate' } }, sessionId)
  await e.service.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const before = await e.service.get(e.id, preview.run.id, sessionId)
  assert.equal(before.status, 'paused')
  const goal = { to: 'seconds', scope: { tracks: ['S02'] }, feedback: '调整本镜动作' }
  const change = await e.service.preview(e.id, before.id, sessionId, { goal })
  assert.ok(change.steps.some(step => step.target === 'film:S02' && step.origin === 'cascade'))
  assert.ok(!change.steps.some(step => step.target === 'film:S01'))
  const amended = await e.service.amend(e.id, before.id, sessionId, { goal, confirmDelete: true, projectRevision: change.projectRevision })
  assert.equal(amended.id, before.id)
  assert.ok(amended.steps.some(step => step.target === 'film:S02' && step.status === 'superseded'))
  assert.equal(amended.steps.filter(step => step.target === 'film:S01' && step.status === 'superseded').length, 0)
  await e.service.drain()
})

test('每秒指令中间镜头审核暂停后，提交意见会继续后续等待镜头', async t => {
  let recovering = false
  const e = await setup(t, { execute: async (_, step) => {
    if (!recovering && ['review', 're_review'].includes(step.kind) && step.target === 'seconds:S02') return { passed: false, issues: [{ reason: '第二镜需要修改' }] }
    return ['review', 're_review'].includes(step.kind) ? { passed: true } : {}
  } })
  await e.store.save(e.id, current => {
    const source = current.episodes[0].shots.items[1], third = structuredClone(source)
    third.id = 'S03'; third.seconds.id = 'seconds:S03'; third.storyboard.id = 'storyboard:S03'; third.video.id = 'film:S03'; third.tailFrame.id = 'tailFrame:S03'
    current.episodes[0].shots.items.push(third)
    return current
  })
  const preview = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'seconds', mode: 'regenerate' } }, sessionId)
  await e.service.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  let paused = await e.service.get(e.id, preview.run.id, sessionId)
  assert.equal(paused.status, 'paused')
  assert.ok(paused.steps.some(step => step.target === 'seconds:S03' && step.status === 'pending'))

  const goal = { to: 'seconds', scope: { tracks: ['S02'] }, mode: 'modify', feedback: '修正第二镜并继续后续镜头' }
  const change = await e.service.preview(e.id, paused.id, sessionId, { goal })
  assert.ok(change.steps.some(step => step.target === 'seconds:S03' && step.origin === 'cascade'))
  recovering = true
  await e.service.amend(e.id, paused.id, sessionId, { goal, confirmDelete: true, projectRevision: change.projectRevision })
  await e.service.drain()
  paused = await e.service.get(e.id, preview.run.id, sessionId)
  assert.equal(paused.status, 'completed')
  assert.ok(paused.steps.filter(step => step.target === 'seconds:S03').some(step => step.status === 'done'))
})

test('每秒指令顶部带意见修订从中断镜头继续，不重跑已通过镜头', async t => {
  let recovering = false; const seen = []
  const e = await setup(t, { execute: async (_, step) => {
    seen.push(`${step.kind}:${step.target}`)
    if (!recovering && ['review', 're_review'].includes(step.kind) && step.target === 'seconds:S02') return { passed: false, issues: [{ reason: '第二镜需要修改' }] }
    return ['review', 're_review'].includes(step.kind) ? { passed: true } : {}
  } })
  await e.store.save(e.id, current => {
    const source = current.episodes[0].shots.items[1], third = structuredClone(source)
    third.id = 'S03'; third.seconds.id = 'seconds:S03'; third.storyboard.id = 'storyboard:S03'; third.video.id = 'film:S03'; third.tailFrame.id = 'tailFrame:S03'
    current.episodes[0].shots.items.push(third)
    return current
  })
  const preview = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'seconds', mode: 'regenerate' } }, sessionId)
  await e.service.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const paused = await e.service.get(e.id, preview.run.id, sessionId)
  // 模拟真实执行器已经把第一镜落定、第二镜记录为未通过，规划器才能从第二镜定位续跑起点。
  await e.store.save(e.id, current => {
    const episode = current.episodes[0]
    episode.shots.items[0].seconds.content = { version: 1, beats: [{}] }
    episode.shots.items[0].seconds.check = { passed: true, failures: [], revision: episode.shots.items[0].seconds.revision }
    episode.shots.items[1].seconds.check = { passed: false, failures: ['第二镜需要修改'], revision: episode.shots.items[1].seconds.revision }
    episode.shots.items[2].seconds.content = null
    episode.shots.items[2].seconds.check = { passed: null, failures: [], revision: episode.shots.items[2].seconds.revision }
    return current
  })
  const prepared = await e.store.read(e.id)
  assert.equal(prepared.episodes[0].shots.items[0].seconds.content?.version, 1)
  assert.equal(prepared.episodes[0].shots.items[0].seconds.check.passed, true)
  const goal = { to: 'seconds', mode: 'modify', feedback: '修正第二镜并继续后续镜头' }
  const change = await e.service.preview(e.id, paused.id, sessionId, { goal })
  assert.deepEqual([...new Set(change.steps.filter(step => step.origin !== 'cascade').map(step => step.target))], ['seconds:S02', 'seconds:S03'], JSON.stringify(change.steps.map(step => [step.kind, step.target, step.origin])))
  recovering = true
  await e.service.amend(e.id, paused.id, sessionId, { goal, confirmDelete: true, projectRevision: change.projectRevision })
  await e.service.drain()
  const current = await e.service.get(e.id, preview.run.id, sessionId)
  assert.equal(current.status, 'completed')
  assert.equal(seen.filter(item => item === 'generate:seconds:S01').length, 1, JSON.stringify(seen))
  assert.ok(seen.includes('generate:seconds:S03'))
})

test('放弃候选图完成对应等待，不无条件要求生成新图', async t => {
  const e = await setup(t, { execute: async () => ({}) })
  const preview = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'images', scope: { itemIds: ['C01'] } } }, sessionId)
  await e.service.confirm(e.id, preview.run.id, sessionId); await e.service.drain()
  const before = await e.store.read(e.id)
  before.episodes[0].pendingImages.draft = { itemId: 'C01' }
  await e.service.contentChanged({ action: 'discard-image', projectId: e.id, episodeId: e.episodeId, draftId: 'draft' }, before)
  notifyProject(e.home, e.id); await e.service.drain()
  const current = await e.service.get(e.id, preview.run.id, sessionId)
  assert.equal(current.status, 'completed'); assert.equal(current.steps.find(step => step.kind === 'wait_confirm').status, 'skipped')
})

test('Run 与旧直接操作共用步骤锁；旧占用释放并发事件后自动出队', async t => {
  const releaseGate = gate(), seen = []
  const e = await setup(t, { execute: async (run, step) => { seen.push(step.kind); await releaseGate.promise; return { passed: true } } })
  const releaseOld = occupy(e.home, e.op('overview'), { id: 'old-op', label: '旧项目编辑' })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
  await until(async () => (await e.service.get(e.id, run.id, sessionId)).steps[0].status === 'ready')
  assert.deepEqual(seen, [])
  releaseOld(); notifyProject(e.home, e.id)
  await until(() => seen.length === 1)
  assert.ok(occupant(e.home, e.op('outline-text')))
  releaseGate.resolve(); await e.service.drain()
  assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'completed')
  assert.equal(occupant(e.home, e.op('outline-text')), null)
})

test('HTTP 同源/会话保护、确认登记 job、失败分支重试和快照归属', async t => {
  let failed = false
  const e = await setup(t, { execute: async (run, step, { record }) => {
    await record('responses', { text: '运行记录' })
    if (!failed) { failed = true; throw new Error('暂时故障') }
    return { passed: true }
  } })
  const handler = runRoutes({ service: e.service, jobs: e.jobs, json: (res, code, value) => { res.code = code; res.value = value }, readJson: async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body) } })
  async function call(path, body, header = true) {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { method: body ? 'POST' : 'GET', headers: header ? { 'x-meiji-request': '1' } : {} })
    const url = new URL('http://test/plugins/meiji/' + path)
    if (!body) { url.searchParams.set('projectId', e.id); url.searchParams.set('sessionId', sessionId) }
    const res = {}; assert.equal(await handler(req, res, url), true); return res
  }
  const denied = await call('runs', { ...e.input, sessionId }, false)
  assert.equal(denied.code, 403)
  const created = await call('runs', { ...e.input, sessionId }), id = created.value.run.id
  assert.equal(created.code, 201)
  assert.equal((await call(`runs/${id}/confirm`, { projectId: e.id, sessionId })).code, 409)
  assert.equal(e.registry.rows.size, 0)
  const confirmed = await call(`runs/${id}/confirm`, { projectId: e.id, sessionId, confirmDelete: true })
  assert.equal(confirmed.code, 200)
  assert.equal(confirmed.value.jobId, undefined, '面板不通知会话')
  const observing = e.jobs.bind(created.value.run, sessionId, { source: 'session' })
  await e.service.drain(); await e.registry.wait(observing, 5000, sessionId)
  assert.equal(JSON.parse(e.registry.read(observing, sessionId).result).status, 'paused')
  assert.equal(e.jobs.guard({ name: 'job_kill', arguments: { job_id: observing } }), undefined)
  const paused = (await call(`runs/${id}`)).value.run, stepId = paused.pause.reasons[0].stepId
  const records = await call(`runs/${id}/steps/${stepId}/responses`)
  assert.equal(records.value.responses.length, 1)
  assert.equal((await call(`runs/${id}/steps/missing/responses`)).code, 404)
  const following = e.jobs.bind(paused, sessionId, { afterRevision: paused.revision, source: 'session' })
  const resumed = await call(`runs/${id}/resume`, { projectId: e.id, sessionId, action: 'retry', stepId })
  assert.equal(resumed.code, 200)
  await e.service.drain(); await e.registry.wait(following, 5000, sessionId)
  assert.equal(JSON.parse(e.registry.read(following, sessionId).result).status, 'completed')
})

test('jobs owner/service 销毁只脱离观察，普通取消仍取消 Run', async t => {
  for (const reason of ['owner disposed', 'jobs service disposed', '用户取消']) {
    const deferred = gate(), e = await setup(t, { execute: async () => { await deferred.promise; return { passed: true } } })
    const { run } = await e.service.plan(e.input, sessionId), id = e.jobs.bind(run, sessionId)
    await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
    await until(async () => (await e.service.get(e.id, run.id, sessionId)).steps[0].status === 'running')
    e.registry.kill(id, sessionId, reason)
    if (reason === '用户取消') await until(async () => (await e.service.get(e.id, run.id, sessionId)).status === 'cancelled')
    deferred.resolve(); await e.service.drain()
    assert.equal((await e.service.get(e.id, run.id, sessionId)).status, reason === '用户取消' ? 'cancelled' : 'completed')
  }
})

test('真实正文快照重启读取走 Run 归属，内容与 Run 均显示中断而非取消', async t => {
  const e = await setup(t, { deps: { request: async message => message.skill === 'review' ? reviewPass : JSON.stringify(outlineFixture('用于重启的正文')) } })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const records = runStore(e.home, e.id)
  await records.update(run.id, current => {
    current.steps[1].status = 'running'; current.endedAt = null
    current.events = current.events.filter(event => event.type !== 'completed')
    return current
  })
  await e.store.save(e.id, root => { root.episodes[0].plot.outline.operation = { id: run.steps[1].id, phase: 'generating' }; return root })
  await interruptRunning(e.store)
  await e.service.recover(e.id); await e.service.drain()
  const current = await e.service.get(e.id, run.id, sessionId)
  assert.equal(current.status, 'paused'); assert.equal(current.endedAt, null)
  assert.equal(current.pause.reasons[0].code, 'interrupted')
  assert.match((await e.read()).plot.outline.error, /任务已暂停/)
  await e.service.resume(e.id, run.id, sessionId, { action: 'retry', stepId: run.steps[1].id }); await e.service.drain()
  assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'completed')
})

test('生产面板统一登录保护在 Run 路由前执行', async t => {
  const e = await setup(t, { execute: async () => ({ passed: true }) }), previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  let handler, loggedIn = false
  registerPanel({ connection: { requestRejection: () => loggedIn ? null : 401 }, logger: { warn() {} }, effect: callback => callback(), on() {}, webServer: { register: value => { handler = value.handler } } }, Promise.resolve(), undefined, e.service, e.jobs)
  const query = new URLSearchParams({ projectId: e.id, sessionId })
  const call = async () => {
    let status, value
    await handler({ url: `/plugins/meiji/runs?${query}`, method: 'GET', headers: {} }, { writeHead: code => { status = code }, end: text => { value = JSON.parse(text) } })
    return { status, value }
  }
  assert.equal((await call()).status, 401)
  loggedIn = true; assert.deepEqual((await call()).value.runs, [])
  const { run } = await e.service.plan(e.input, sessionId)
  const artifact = await runStore(e.home, e.id).record(run.id, run.steps[0].id, 'artifacts', { content: '新 Run 的正文快照', published: true })
  let artifactStatus, result
  await handler({ url: `/plugins/meiji/artifacts/${artifact.id}?${query}`, method: 'GET', headers: {} }, { writeHead: code => { artifactStatus = code }, end: text => { result = JSON.parse(text) } })
  assert.equal(artifactStatus, 200); assert.equal(result.artifact.runId, run.id)
})

test('与旧执行链共享队列时不叠加并发名额，排队 Run 可取消', async t => {
  const deferred = gate(), queue = createQueue(() => 1)
  const old = queue.run('text', null, () => deferred.promise)
  let calls = 0
  const e = await setup(t, { queue, execute: async () => { calls++; return { passed: true } } })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
  await until(() => queue.stats().text.waiting === 1)
  assert.equal(calls, 0)
  assert.equal(occupant(e.home, e.op('outline-text')), null, 'ready 排队时不占用内容编辑锁')
  await e.service.cancel(e.id, run.id, sessionId)
  deferred.resolve(); await old; await e.service.drain()
  assert.equal(calls, 0); assert.equal(queue.stats().text.active, 0)
  assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'cancelled')
})

test('取消期间晚到的真实模型正文不会覆盖已保存数据', async t => {
  const deferred = gate(); let started = false
  const e = await setup(t, { deps: { request: async () => { started = true; await deferred.promise; return JSON.stringify(outlineFixture('不应写入的迟到稿')) } } })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true })
  await until(() => started)
  await e.service.cancel(e.id, run.id, sessionId)
  const baseline = JSON.stringify((await e.read()).plot.outline.content)
  deferred.resolve(); await e.service.drain()
  assert.equal((await e.service.get(e.id, run.id, sessionId)).status, 'cancelled')
  assert.equal(JSON.stringify((await e.read()).plot.outline.content), baseline)
})

test('真实审核用尽后人工放行同 Run，保留项目与剧集身份，会话不可放行', async t => {
  const e = await setup(t, { deps: { request: async message => message.skill === 'review' ? JSON.stringify({ passed: false, issues: [{ location: '转折', reason: '需人工取舍', requirement: '明确转折' }] }) : JSON.stringify(outlineFixture('等待人工确认')) } })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const paused = await e.service.get(e.id, run.id, sessionId), stepId = paused.pause.reasons[0].stepId
  assert.equal(paused.pause.reasons[0].code, 'review_exhausted')
  await assert.rejects(e.service.resume(e.id, run.id, sessionId, { action: 'override', stepId }, 'session'), { status: 403 })
  await e.service.resume(e.id, run.id, sessionId, { action: 'override', stepId }); await e.service.drain()
  const root = await e.store.read(e.id)
  assert.equal(root.id, e.id); assert.equal(root.episodes[0].id, e.episodeId)
  assert.equal(root.episodes[0].plot.outline.check.passed, true)
  const saved = await e.service.get(e.id, run.id, sessionId)
  assert.equal(saved.status, 'completed'); assert.equal(saved.steps.at(-1).kind, 'override')
  assert.equal(saved.steps.find(step => step.id === stepId).output.passed, false)
})
