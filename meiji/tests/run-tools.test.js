import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { fakeJobs } from './fixtures/fake-jobs.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { createHarnessRunJobs } from '../server/host/harness-run-jobs.js'
import { subscribeProject } from '../server/data/project-events.js'
import { runTools } from '../tools/run-tools.js'
import { contextQueryTool } from '../tools/operation-context-query.js'
const sessionId = 'session-11111111-1111-4111-8111-111111111111'
async function setup(t, execute = async () => ({ passed: true })) {
  const e = await setupModel(t); useWorkspaces(t); await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const runs = createRunService({ home: e.home, execute }), registry = fakeJobs(), runJobs = createHarnessRunJobs({ home: e.home, registry, readRun: (...args) => runs.get(...args), cancelRun: (...args) => runs.cancel(...args), subscribeProject })
  t.after(async () => { runJobs.dispose(); await runs.dispose() })
  const exec = { agent: { session: { id: sessionId } } }, tools = runTools({ home: e.home, runs, runJobs })
  return { ...e, runs, registry, runJobs, exec, tools, call: async (name, args) => JSON.parse(await tools.find(tool => tool.name === name).execute(args, exec)) }
}
test('会话提交目标即执行：重新生成不询问删除，结果说明步骤与清理的内容', async t => {
  let calls = 0; const e = await setup(t, async () => { calls++; return { passed: true } })
  const started = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } })
  assert.equal(started.started, true); assert.ok(started.jobId); assert.equal(started.merged, false)
  assert.deepEqual(started.steps, ['outline×2','summary×1']); assert.ok(started.deleted.length)
  await e.runs.drain(); assert.equal(calls, 3)
  const run = await e.runs.get(e.id, started.runId, sessionId)
  assert.equal(run.status, 'completed'); assert.equal(run.initiator, 'session')
  assert.ok(run.events.some(event => event.type === 'deletions_confirmed'))
  const info = JSON.parse(await contextQueryTool({ home: e.home, runs: e.runs }).execute({}, e.exec))
  assert.deepEqual(info.current.runs, [])
})
test('同集已有暂停任务时新目标自动并入；失败结束的任务不并入，重新发起新建任务；补大纲前置不隐式生成人物', async t => {
  let failing = true
  const e = await setup(t, async () => { if (failing) throw new Error('连接失败'); return { passed: true } })
  const first = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'shots', mode: 'regenerate' } })
  await e.runs.drain()
  const ended = await e.runs.get(e.id, first.runId, sessionId)
  assert.equal(ended.status, 'failed'); assert.equal(ended.failure.message, '连接失败')
  failing = false
  const again = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'shots', mode: 'regenerate' } })
  assert.equal(again.started, true); assert.equal(again.merged, false); assert.notEqual(again.runId, first.runId)
  await e.runs.drain()
  assert.equal((await e.runs.get(e.id, again.runId, sessionId)).status, 'completed')
  // 用户暂停中的任务仍是进行中：同集新目标并入它。
  const open = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'shots', mode: 'regenerate' } })
  await e.runs.pause(e.id, open.runId, sessionId); await e.runs.drain()
  assert.equal((await e.runs.get(e.id, open.runId, sessionId)).status, 'paused')
  const merged = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'story', mode: 'regenerate' } })
  assert.equal(merged.started, true); assert.equal(merged.merged, true); assert.equal(merged.runId, open.runId)
  await e.call('run-resume', { runId: open.runId, action: 'resume' }); await e.runs.drain()
  const run = await e.runs.get(e.id, open.runId, sessionId)
  // 剧情重做后，原目标内的镜头表作为下游重做，不会停在「缺少前置」。
  assert.equal(run.status, 'completed', JSON.stringify(run.steps.map(step => [step.id.slice(0,8), step.kind, step.target, step.status, step.origin, step.after.map(id => id.slice(0,8))])))
  assert.ok(run.steps.some(step => step.target === 'shots' && step.origin === 'cascade' && step.status === 'done'))
  // 补图是旁支：重做的镜头表不挂在补图步骤后面。
  const imageIds = new Set(run.steps.filter(step => step.kind === 'image' || step.target.startsWith('images:')).map(step => step.id))
  assert.equal(imageIds.size, 0)
  assert.ok(run.steps.filter(step => step.target === 'shots').every(step => !step.after.some(id => imageIds.has(id))))
  // 大纲需要重做时自动补齐大纲；镜头目标不要求提前生成人物。
  await e.store.save(e.id, root => { root.episodes[0].plot.outline.check.passed = false; return root })
  const next = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'shots', mode: 'regenerate' } })
  assert.equal(next.started, true)
  await e.runs.drain()
  assert.equal((await e.runs.get(e.id, next.runId, sessionId)).status, 'completed')
  assert.ok(!JSON.stringify(next.steps || []).includes('characters'))
})

test('等待前置的任务 authorize 不带参数即补做全部前置；多余参数被忽略；报错附状态且不留后台任务', async t => {
  // 模拟执行器：审核大纲的步骤把大纲置为通过，等待它的镜头表随后自动解除暂停。
  let store, id
  const e = await setup(t, async (_run, step) => { if (step.kind === 'review' && step.target === 'outline') await store.save(id, root => { root.episodes[0].plot.outline.check.passed = true; return root }); return { passed: true } })
  store = e.store; id = e.id
  await e.store.save(e.id, root => { root.episodes[0].plot.outline.check.passed = false; return root })
  const preview = await e.runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'shots', mode: 'regenerate' } }, sessionId, 'panel')
  await e.runs.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.runs.drain()
  const paused = await e.runs.get(e.id, preview.run.id, sessionId)
  assert.deepEqual(paused.pause.reasons.map(reason => reason.code), ['prereq_required'])
  const jobs = e.registry.rows.size
  await assert.rejects(e.call('run-resume', { runId: preview.run.id, action: 'resume', feedback: '多余', confirmDelete: true }), /不允许该动作。任务当前状态：paused；暂停原因：.*可用动作：authorize、cancel-branch。请勿重复相同调用/)
  assert.equal(e.registry.rows.size, jobs)
  const resumed = await e.call('run-resume', { runId: preview.run.id, action: 'authorize', feedback: '多余参数' })
  assert.ok(resumed.jobId); await e.runs.drain()
  const final = await e.runs.get(e.id, preview.run.id, sessionId)
  assert.equal(final.status, 'completed', JSON.stringify([final.pause, final.steps.map(step => [step.kind, step.target, step.status, step.origin])]))
})
test('面板任务可被会话找到并追加意见，模型不能调用人工放行', async t => {
  let calls = 0; const gate = Promise.withResolvers()
  const e = await setup(t, async () => { calls++; if (calls === 1) await gate.promise; return { passed: true } })
  const preview = await e.runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } }, sessionId, 'panel')
  await e.runs.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true })
  while (calls < 1) await new Promise(resolve => setTimeout(resolve, 5))
  await e.runs.pause(e.id, preview.run.id, sessionId); gate.resolve(); await e.runs.drain()
  const info = JSON.parse(await contextQueryTool({ home: e.home, runs: e.runs }).execute({}, e.exec))
  assert.equal(info.current.runs[0].pause.reasons[0].code, 'user_paused')
  await assert.rejects(e.call('run-resume', { runId: preview.run.id, action: 'override', target: 'outline' }), /无效/)
  const amended = await e.call('run-amend', { runId: preview.run.id, target: 'outline', feedback: '加强因果' })
  assert.equal(amended.runId, preview.run.id)
  await e.call('run-resume', { runId: preview.run.id, action: 'resume' }); await e.runs.drain()
  const done = await e.runs.get(e.id, preview.run.id, sessionId)
  assert.equal(done.status, 'completed')
  assert.ok(done.steps.some(step => step.target === 'outline' && step.origin === 'user-feedback' && step.status === 'done'))
  assert.equal(e.runJobs.guard({ name: 'job_kill', arguments: { job_id: amended.jobId } }), undefined)
})

test('会话忽略未知参数，拒绝跳集及未绑定项目，不接受客户端身份和执行步骤', async t => {
  const e = await setup(t)
  await assert.rejects(e.call('run-plan', { episodeNumber: 1, goal: { to: 'film', actor: 'human' } }), /不支持的字段/)
  const ignored = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' }, actor: 'human', steps: [{ kind: 'override' }] })
  assert.deepEqual(ignored.steps, ['outline×2','summary×1']); await e.runs.drain()
  assert.ok((await e.runs.get(e.id, ignored.runId, sessionId)).steps.every(step => step.actor === 'model'))
  await assert.rejects(e.call('run-plan', { episodeNumber: 3, goal: { to: 'summary' } }), /不能跳集/)
  const tool = e.tools.find(item => item.name === 'run-plan')
  await assert.rejects(tool.execute({ goal: { to: 'film' } }, { agent: { session: { id: 'another' } } }), /没有项目/)
})

test('执行失败后任务结束：会话不能在原任务继续，用原目标重新 run-plan 新建任务；失败的工具调用不留下后台任务', async t => {
  let fail = true
  const e = await setup(t, async () => { if (fail) throw new Error('upstream service error'); return { passed: true } })
  const goal = { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' }
  const preview = await e.call('run-plan', { episodeNumber: 1, goal })
  await e.runs.drain()
  assert.equal((await e.runs.get(e.id, preview.runId, sessionId)).status, 'failed')
  const jobs = e.registry.rows.size
  await assert.rejects(e.call('run-resume', { runId: preview.runId, action: 'resume' }), /任务已经结束/)
  await assert.rejects(e.call('run-resume', { runId: preview.runId, action: 'retry' }), /retry|action/)
  assert.equal(e.registry.rows.size, jobs)
  fail = false
  const again = await e.call('run-plan', { episodeNumber: 1, goal })
  assert.ok(again.jobId); assert.notEqual(again.runId, preview.runId); await e.runs.drain()
  assert.equal((await e.runs.get(e.id, again.runId, sessionId)).status, 'completed')
})
