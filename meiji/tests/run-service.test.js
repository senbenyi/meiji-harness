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
  assert.deepEqual(run.steps.map(step => step.kind), ['generate', 'review','generate'])
  // 锁范围由服务端按对象推导（剧情属于项目级写入），客户端传入的 lock 无效。
  assert.ok(run.steps.every(step => step.scope === (step.target === 'summary' ? 'episode' : 'project')))
  await assert.rejects(e.service.confirm(e.id, run.id, sessionId), { code: 'DELETIONS_PENDING' })
  await assert.rejects(e.service.get(e.id, run.id, 'unbound'), { status: 409 })
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  assert.equal(calls, 3)
  const rows = await e.service.list(e.id, sessionId, { episodeId: e.episodeId, target: 'outline' })
  assert.equal(rows.length, 1); assert.equal(rows[0].done, 3)
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

test('摘要未生成或未通过也不阻断故事目标', async t => {
 let calls=0;const e=await setup(t,{execute:async()=>{calls++;return {passed:true}}})
 await e.store.save(e.id,root=>{root.episodes[0].summary.check.passed=false;root.episodes[0].summary.content=null;return root})
 const {run,prereq}=await e.service.plan(e.input,sessionId)
 assert.equal(prereq.length,0)
 await e.service.confirm(e.id,run.id,sessionId,{confirmDelete:true});await e.service.drain()
 assert.equal(calls,3);assert.equal((await e.service.get(e.id,run.id,sessionId)).status,'completed')
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

test('每秒指令中间镜头审核用尽后任务直接结束；再次修改新建任务，从中断镜头继续，不重跑已通过镜头', async t => {
  for (const feedback of ['修正第二镜并继续后续镜头', undefined]) {
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
    const failed = await e.service.get(e.id, preview.run.id, sessionId)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.failure.code, 'review_exhausted'); assert.equal(failed.failure.target, 'seconds:S02')
    assert.ok(failed.steps.filter(step => step.target === 'seconds:S03').every(step => step.status === 'superseded'))
    await assert.rejects(e.service.resume(e.id, failed.id, sessionId, { action: 'override', stepId: failed.failure.stepId }), { status: 409 })
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
    recovering = true
    const next = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'seconds', mode: 'modify', ...(feedback ? { feedback } : {}) } }, sessionId)
    assert.notEqual(next.run.id, failed.id)
    assert.deepEqual([...new Set(next.run.steps.map(step => step.target))], ['seconds:S02', 'seconds:S03'])
    await e.service.confirm(e.id, next.run.id, sessionId, { confirmDelete: true }); await e.service.drain()
    const retried = await e.service.get(e.id, next.run.id, sessionId)
 assert.equal(retried.status, 'completed', JSON.stringify(retried.failure))
    assert.equal(seen.filter(item => item === 'generate:seconds:S01').length, 1, JSON.stringify(seen))
    assert.ok(seen.includes('generate:seconds:S03'))
  }
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

test('HTTP 同源/会话保护、确认登记 job、失败后结束并可重新发起、快照归属', async t => {
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
  const observed = JSON.parse(e.registry.read(observing, sessionId).result)
  assert.equal(observed.status, 'failed'); assert.equal(observed.failure.message, '暂时故障')
  assert.equal(e.jobs.guard({ name: 'job_kill', arguments: { job_id: observing } }), undefined)
  const ended = (await call(`runs/${id}`)).value.run, stepId = ended.failure.stepId
  const records = await call(`runs/${id}/steps/${stepId}/responses`)
  assert.equal(records.value.responses.length, 1)
  assert.equal((await call(`runs/${id}/steps/missing/responses`)).code, 404)
  // 执行失败后任务已结束：不能在原任务重试，重新发起会新建任务。
  assert.equal((await call(`runs/${id}/resume`, { projectId: e.id, sessionId, action: 'retry', stepId })).code, 409)
  const again = await call('runs', { ...e.input, sessionId })
  assert.equal(again.code, 201); assert.notEqual(again.value.run.id, id)
  const following = e.jobs.bind(again.value.run, sessionId, { source: 'session' })
  assert.equal((await call(`runs/${again.value.run.id}/confirm`, { projectId: e.id, sessionId, confirmDelete: true })).code, 200)
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

test('真实正文快照重启读取走 Run 归属，内容与 Run 均显示中断结束而非取消，可重新发起', async t => {
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
  assert.equal(current.status, 'failed'); assert.ok(current.endedAt)
  assert.equal(current.failure.code, 'interrupted')
  assert.match((await e.read()).plot.outline.error, /任务已结束/)
  await assert.rejects(e.service.resume(e.id, run.id, sessionId, { action: 'retry', stepId: run.steps[1].id }), { status: 409 })
  const { run: next } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, next.id, sessionId, { confirmDelete: true }); await e.service.drain()
  assert.equal((await e.service.get(e.id, next.id, sessionId)).status, 'completed')
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

test('真实审核用尽后任务直接结束，保留项目与剧集身份，不能在原任务放行', async t => {
  const e = await setup(t, { deps: { request: async message => message.skill === 'review' ? JSON.stringify({ passed: false, issues: [{ location: '转折', reason: '需人工取舍', requirement: '明确转折' }] }) : JSON.stringify(outlineFixture('等待人工确认')) } })
  const { run } = await e.service.plan(e.input, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const ended = await e.service.get(e.id, run.id, sessionId), stepId = ended.failure.stepId
  assert.equal(ended.status, 'failed'); assert.equal(ended.failure.code, 'review_exhausted')
  assert.equal(ended.steps.find(step => step.id === stepId).output.passed, false)
  await assert.rejects(e.service.resume(e.id, run.id, sessionId, { action: 'override', stepId }), { status: 409 })
  const root = await e.store.read(e.id)
  assert.equal(root.id, e.id); assert.equal(root.episodes[0].id, e.episodeId)
  assert.equal(root.episodes[0].plot.outline.check.passed, false)
})

test('独立人物任务审核通过后只为缺图人物生图并自动保存，不等待确认', async t => {
  const seen = []
  const e = await setup(t, { execute: async (_run, step) => { seen.push(`${step.kind}@${step.target}`); return ['review', 're_review'].includes(step.kind) ? { passed: true } : {} } })
  await e.store.save(e.id, root => {
    const existing = structuredClone(root.episodes[0].plot.characters.items[0])
    existing.id = 'C02'; existing.name = '旧人物'; existing.image.id = 'image:C02'
    existing.image.content = { assetId: 'existing', localPath: '/existing.png' }
    root.episodes[0].plot.characters.items.push(existing)
    return root
  })
  const { run } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'characters' }, mode: 'regenerate' } }, sessionId)
  await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
  const done = await e.service.get(e.id, run.id, sessionId)
  assert.equal(done.status, 'completed', JSON.stringify(done.failure))
  const plot = (await e.read()).plot, missing = card => !card.image.content?.localPath
  // 已有人物图直接复用；场景即使缺图也不进入任务。
  const expected = plot.characters.items.filter(missing).map(card => `image@image:${card.id}`)
  assert.ok(expected.length && plot.characters.items.some(card => !missing(card)))
  assert.deepEqual(seen.filter(item => item.startsWith('image@')).sort(), expected.sort())
  assert.ok(!done.steps.some(step => step.kind === 'wait_confirm'))
  assert.ok(done.steps.filter(step => step.kind === 'image').every(step => step.input.operation.autoSave === true))
  assert.ok(!done.steps.some(step => step.target === 'scenes' || step.target === 'props' || step.target === 'images:scenes'))
  for (const kind of ['characters']) {
    const first = seen.findIndex(item => plot[kind].items.some(card => item === `image@image:${card.id}`))
    if (first >= 0) assert.ok(seen.indexOf(`review@${kind}`) < first, `${kind} 补图须在提取审核通过后`)
  }
})


test('无效库引用在提取时失败并保留旧人物，可重新生成且异常不自动生图', async t => {
 const { storyPackageFixture, storyRequest } = await import('./fixtures/story-package.js')
 const { mergeLibraryGroup } = await import('../shared/library-rules.js')
 const { scopeProjects } = await import('../server/data/episode-data.js')
 const fixture = storyPackageFixture(); let images = 0
 const e = await setup(t, { deps: { request: storyRequest(fixture), submitAssetImage: async () => { images++ } } })
 const current = await e.read()
 await scopeProjects(e.store, e.episodeId).save(e.id, mergeLibraryGroup(current, 'characters', current.plot.characters))
 const entry = (await e.store.read(e.id)).library.characters[0], oldCharacters = (await e.read()).plot.characters
 fixture.characters.items[0].libraryId = 'R999'
 fixture.characters.items[0].name = '新人物身体'
 const input = { projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'characters' }, mode: 'regenerate' } }
 const { run } = await e.service.plan(input, sessionId)
 await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
 const done = await e.service.get(e.id, run.id, sessionId), failed = await e.read()
 assert.equal(done.status, 'failed'); assert.match(done.failure.message, /库条目不存在/)
 assert.equal(failed.plot.characters.status, 'passed'); assert.equal(failed.plot.characters.error, null)
 assert.deepEqual(failed.plot.characters.items, oldCharacters.items)
 assert.equal(images, 0)
 delete fixture.characters.items[0].libraryId
 const next = await e.service.plan(input, sessionId)
 await e.service.confirm(e.id, next.run.id, sessionId, { confirmDelete: true }); await e.service.drain()
 const retried = await e.service.get(e.id, next.run.id, sessionId)
 assert.equal(retried.status, 'completed', JSON.stringify(retried.failure))
 assert.equal((await e.read()).plot.characters.error, null)
 assert.equal((await e.read()).plot.characters.check.passed, true)
})


test('人物指定已有 libraryId 与合法名称时真实审核复用唯一资料并继续自动生图保存', async t => {
 const { storyPackageFixture, storyRequest } = await import('./fixtures/story-package.js')
 const { mergeLibraryGroup } = await import('../shared/library-rules.js')
 const { scopeProjects } = await import('../server/data/episode-data.js')
 const { saveImageDraft } = await import('../server/data/image-storage.js')
 const fixture = storyPackageFixture(); let images = 0
 const e = await setup(t, { deps: { request: storyRequest(fixture), submitAssetImage: async args => {
   images++
   const pendingImage = await saveImageDraft(e.home, Buffer.from('new image'), 'image/png', 'characters', args.itemId, { projectId: e.id, episodeId: e.episodeId, itemId: args.itemId })
   const next = { ...args.assets, items: args.assets.items.map(item => item.id === args.itemId ? { ...item, pendingImage } : item) }
   await args.onSaved(next); return next
 } } })
 const current = await e.read()
 await scopeProjects(e.store, e.episodeId).save(e.id, mergeLibraryGroup(current, 'characters', current.plot.characters))
 const entry = (await e.store.read(e.id)).library.characters[0]
 fixture.characters.items[0].libraryId = entry.id
 fixture.characters.items[0].name = entry.name
 const { run } = await e.service.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'characters' }, mode: 'regenerate' } }, sessionId)
 await e.service.confirm(e.id, run.id, sessionId, { confirmDelete: true }); await e.service.drain()
 const done = await e.service.get(e.id, run.id, sessionId), saved = await e.read(), root = await e.store.read(e.id)
 assert.equal(done.status, 'completed', JSON.stringify(done.failure))
 assert.equal(saved.plot.characters.check.passed, true)
 assert.equal(saved.plot.characters.error, null)
 assert.equal(root.library.characters.length, 1)
 assert.equal(root.library.characters[0].variants.length, 1)
 assert.deepEqual(saved.plot.characters.items[0].ref, { libraryId: entry.id, variantId: entry.defaultVariantId, linkedBy: 'model' })
 assert.equal(images, 1)
 assert.ok(saved.plot.characters.items[0].image.content.assetId)
 assert.deepEqual(saved.pendingImages, {})
})


test('展示摘要提取失败仅记录旁支错误，不让已通过大纲任务失败或阻断拆镜',async t=>{
 const e=await setup(t,{deps:{request:async message=>message.skill==='review'?reviewPass:message.skill==='episode'?'{"summary":""}':JSON.stringify(outlineFixture('完整故事'))}})
 const {run}=await e.service.plan(e.input,sessionId)
 await e.service.confirm(e.id,run.id,sessionId,{confirmDelete:true});await e.service.drain()
 const saved=await e.service.get(e.id,run.id,sessionId),view=await e.read()
 assert.equal(saved.status,'completed');assert.equal(view.plot.outline.check.passed,true)
 assert.match(saved.steps.find(step=>step.target==='summary').output.optionalError,/摘要/)
 const {canGenerate}=await import('../shared/generation-gates.js');assert.equal(canGenerate(view,'shots'),true)
})
